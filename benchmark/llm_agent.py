"""
llm_agent.py

A generic ``LLMAgent`` for calling LLMs across multiple hosting platforms behind
one interface. Used by the ORBIT benchmark harness to evaluate models on the
dataset.

Supported services (selected via the ``service`` argument):

  - RITS       IBM Research Inference (litellm, OpenAI-compatible)
  - WATSONX    IBM watsonx.ai foundation models
  - OPENAI     OpenAI / OpenAI-compatible endpoint (litellm)
  - ANTHROPIC  Anthropic Claude
  - LITELLM    Any generic OpenAI-compatible gateway (e.g. a LiteLLM proxy)

Credentials are read from environment variables (e.g. a ``.env`` file in the
working directory). See ``.env.example`` for the full list. No secrets are
hard-coded here.

Features:
  - Unified ``call_llm(prompt, system_prompt="")`` interface, plus a ``call()``
    alias.
  - Automatic retries with exponential backoff on transient errors
    (rate limits, overloads, 5xx, timeouts).
  - On-disk response cache (shelve) keyed by (service, model, params, prompt).
  - WatsonX support with new (``ibm_watsonx_ai``) and legacy
    (``ibm_watson_machine_learning``) SDK fallback, and model-aware chat
    templates for Llama / Granite-4 prompt formats.

Example:
    from llm_agent import LLMAgent
    agent = LLMAgent(service="RITS", model_name="ibm/granite-3-2-8b-instruct")
    print(agent.call_llm("What is 2 + 2?"))
"""

from __future__ import annotations

import os
import time
import shelve
import traceback

import litellm
from dotenv import load_dotenv

load_dotenv(override=True)

# --------------------------------------------------------------------------- #
# RITS model catalog
# --------------------------------------------------------------------------- #
RITS_API_KEY = os.getenv("RITS_API_KEY")

RITS_MODELS = {
    "ibm/granite-3-2-8b-instruct": {
        "model_id": "openai/ibm-granite/granite-3.2-8b-instruct",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/granite-3-2-8b-instruct/v1",
        "max_new_tokens": 12800,
        "prompt_template": "<|start_of_role|>user<|end_of_role|>{user_input}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>",
    },
    "ibm/granite-3-1-8b-instruct": {
        "model_id": "openai/ibm-granite/granite-3.1-8b-instruct",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/granite-3-1-8b-instruct/v1",
        "max_new_tokens": 12800,
        "prompt_template": "<|start_of_role|>user<|end_of_role|>{user_input}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>",
    },
    "ibm/granite-3-0-8b-instruct": {
        "model_id": "openai/ibm-granite/granite-3.0-8b-instruct",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/granite-3-0-8b-instruct/v1",
        "max_new_tokens": 2048,
        "prompt_template": "<|start_of_role|>user<|end_of_role|>{user_input}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>",
    },
    "ibm/granite-3-0-8b-base": {
        "model_id": "openai/ibm-granite/granite-3.0-8b-base",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/granite-3-0-8b-base/v1",
        "max_new_tokens": 1280,
        "prompt_template": "<|start_of_role|>user<|end_of_role|>{user_input}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>",
    },
    "Llama-3.1-8B-Instruct": {
        "model_id": "openai/meta-llama/Llama-3.1-8B-Instruct",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/llama-3-1-8b-instruct",
        "max_new_tokens": 4096,
        "prompt_template": "<s>[INST] {user_input} [/INST]",
    },
    "Llama-3.1-70B-Instruct": {
        "model_id": "openai/meta-llama/Llama-3.1-70B-Instruct",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/llama-3-1-70b-instruct",
        "max_new_tokens": 4096,
        "prompt_template": "<s>[INST] {user_input} [/INST]",
    },
    "granite-34b-code-instruct-8k": {
        "model_id": "openai/ibm-granite/granite-34b-code-instruct-8k",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/granite-34b-code-instruct-8k",
        "max_new_tokens": 4096,
        "prompt_template": "<s>[INST] {user_input} [/INST]",
    },
    "gpt-oss-120b": {
        "model_id": "openai/gpt-oss-120b",
        "api_base": "https://inference-3scale-apicast-production.apps.rits.fmaas.res.ibm.com/gpt-oss-120b/v1",
        "max_new_tokens": 8192,
        "prompt_template": "{user_input}",
    },
}

WATSONX_URL = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com")


class LLMAgent:
    """A generic agent for calling LLM services across multiple providers."""

    # Class-level on-disk response cache, shared across instances in a process.
    _cache = {}
    _cache_file = os.getenv("LLM_AGENT_CACHE", "./data/cache/llm_agent_cache.db")
    _cache_loaded = False

    def __init__(
        self,
        service: str = "RITS",
        model_name: str = "ibm/granite-3-2-8b-instruct",
        temperature: float = 0.25,
        max_tokens: int | None = None,
        use_cache: bool = True,
    ):
        """
        Args:
            service: One of RITS, WATSONX, OPENAI, ANTHROPIC, LITELLM (case-insensitive).
            model_name: Model identifier. For RITS it must be a key in ``RITS_MODELS``;
                for other providers it is the provider's own model id.
            temperature: Sampling temperature.
            max_tokens: Override the max output tokens. If None, a per-provider
                default is used.
            use_cache: Whether to read/write the on-disk response cache.
        """
        self.service = service.upper()
        self.temperature = temperature
        self.use_cache = use_cache
        self.prompt_template = "{user_input}"

        if use_cache and not LLMAgent._cache_loaded:
            self._load_cache()

        if self.service == "RITS":
            if model_name not in RITS_MODELS:
                raise ValueError(
                    f"Unknown RITS model: {model_name}. "
                    f"Available: {list(RITS_MODELS.keys())}"
                )
            info = RITS_MODELS[model_name]
            self.model_id = info["model_id"]
            self.api_base = info["api_base"]
            self.prompt_template = info.get("prompt_template", "{user_input}")
            self.max_new_tokens = max_tokens or info.get("max_new_tokens", 2048)
            if not RITS_API_KEY:
                raise ValueError("RITS_API_KEY not found in environment")

        elif self.service == "OPENAI":
            self.model_id = model_name or os.getenv("OPENAI_MODEL_ID")
            self.api_base = os.getenv("OPENAI_API_BASE")  # optional
            self.openai_api_key = os.getenv("OPENAI_API_KEY")
            self.prompt_template = os.getenv("OPENAI_PROMPT_TEMPLATE", "{user_input}")
            self.max_new_tokens = max_tokens or int(os.getenv("OPENAI_MAX_NEW_TOKENS", "2048"))
            if not self.model_id or not self.openai_api_key:
                raise ValueError("OPENAI_MODEL_ID or OPENAI_API_KEY not found in environment")

        elif self.service == "WATSONX":
            self.model_id = model_name
            self.watsonx_api_key = os.getenv("WATSONX_APIKEY") or os.getenv("WATSONX_API_KEY")
            self.watsonx_project_id = os.getenv("WATSONX_PROJECT_ID")
            self.prompt_template = os.getenv("WATSONX_PROMPT_TEMPLATE", "{user_input}")
            self.max_new_tokens = max_tokens or int(os.getenv("WATSONX_MAX_NEW_TOKENS", "8192"))
            if not self.watsonx_api_key or not self.watsonx_project_id:
                raise ValueError("WATSONX_APIKEY or WATSONX_PROJECT_ID not found in environment")

        elif self.service == "ANTHROPIC":
            self.model_id = model_name
            self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
            self.max_new_tokens = max_tokens or int(os.getenv("ANTHROPIC_MAX_NEW_TOKENS", "4096"))
            if not self.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY not found in environment")

        elif self.service == "LITELLM":
            self.model_id = model_name
            self.litellm_api_key = os.getenv("LITELLM_API_KEY")
            self.litellm_base_url = os.getenv("LITELLM_BASE_URL")
            self.max_new_tokens = max_tokens or int(os.getenv("LITELLM_MAX_NEW_TOKENS", "10000"))
            if not self.litellm_api_key:
                raise ValueError("LITELLM_API_KEY not found in environment")
            if not self.litellm_base_url:
                raise ValueError("LITELLM_BASE_URL not found in environment")

        else:
            raise ValueError(f"Unsupported service: {self.service}")

    # ------------------------------------------------------------------ #
    # Cache
    # ------------------------------------------------------------------ #
    @classmethod
    def _load_cache(cls):
        """Load the on-disk shelve cache into the class-level dict (once per process)."""
        try:
            cache_dir = os.path.dirname(cls._cache_file)
            if cache_dir:
                os.makedirs(cache_dir, exist_ok=True)
            with shelve.open(cls._cache_file, flag="c") as db:
                for key, value in db.items():
                    cls._cache[key] = value
            cls._cache_loaded = True
        except Exception as e:
            print(f"[WARNING] Could not load cache from disk: {e}")

    @classmethod
    def _save_cache(cls):
        """Persist the class-level cache dict to disk (shelve)."""
        try:
            cache_dir = os.path.dirname(cls._cache_file)
            if cache_dir:
                os.makedirs(cache_dir, exist_ok=True)
            with shelve.open(cls._cache_file, flag="c") as db:
                for key, value in cls._cache.items():
                    db[key] = value
        except Exception as e:
            print(f"[WARNING] Could not save cache to disk: {e}")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def format_prompt(self, refined_schema: str, user_input: str) -> str:
        """Format a schema + utterance pair using the model's prompt template."""
        return self.prompt_template.format(
            user_input=f"Schema: {refined_schema} Utterance: {user_input}"
        )

    @staticmethod
    def _build_messages(prompt: str, system_prompt: str = "") -> list[dict]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return messages

    def _messages_to_text(self, messages: list[dict]) -> str:
        """Flatten chat messages into a single prompt string for completion-style
        (non-chat) backends such as WatsonX, using a model-aware chat template."""
        model_lc = self.model_id.lower()
        is_llama = "llama" in model_lc
        is_granite4 = "granite-4" in model_lc or "granite4" in model_lc

        if is_llama:
            parts = ["<|begin_of_text|>"]
            for m in messages:
                parts.append(
                    f"<|start_header_id|>{m['role']}<|end_header_id|>\n\n{m['content']}<|eot_id|>"
                )
            parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
            return "".join(parts)

        if is_granite4:
            parts = []
            for m in messages:
                parts.append(
                    f"<|start_of_role|>{m['role']}<|end_of_role|>{m['content']}<|end_of_text|>\n"
                )
            parts.append("<|start_of_role|>assistant<|end_of_role|>")
            return "".join(parts)

        # Default: prepend system text, then the user content.
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        user = "\n".join(m["content"] for m in messages if m["role"] != "system")
        return f"{system}\n\n{user}".strip() if system else user

    @staticmethod
    def _is_retryable_error(error: Exception) -> bool:
        """True if the error looks transient (rate limit, overload, 5xx, timeout)."""
        error_str = str(error).lower()
        error_type = type(error).__name__
        retryable_patterns = [
            "overloaded", "rate_limit", "ratelimit", "too many requests",
            "timeout", "temporarily unavailable",
            "429", "500", "502", "503", "504",
        ]
        retryable_types = [
            "InternalServerError", "RateLimitError",
            "TimeoutError", "ServiceUnavailableError", "APIConnectionError",
        ]
        return (
            any(p in error_str for p in retryable_patterns)
            or any(t in error_type for t in retryable_types)
        )

    # ------------------------------------------------------------------ #
    # Per-provider calls
    # ------------------------------------------------------------------ #
    def _call_rits(self, messages: list[dict]) -> str:
        response = litellm.completion(
            model=self.model_id,
            api_base=self.api_base,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_new_tokens,
            api_key=RITS_API_KEY,
            extra_headers={"RITS_API_KEY": RITS_API_KEY},
        )
        return response.choices[0].message.content

    def _call_openai(self, messages: list[dict]) -> str:
        kwargs = dict(
            model=self.model_id,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_new_tokens,
            api_key=self.openai_api_key,
        )
        if self.api_base:
            kwargs["api_base"] = self.api_base
        response = litellm.completion(**kwargs)
        return response.choices[0].message.content

    def _call_anthropic(self, messages: list[dict]) -> str:
        from anthropic import Anthropic

        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        user_messages = [m for m in messages if m["role"] != "system"]
        client = Anthropic(api_key=self.anthropic_api_key)
        response = client.messages.create(
            model=self.model_id,
            max_tokens=self.max_new_tokens,
            temperature=self.temperature,
            system=system or None,
            messages=user_messages,
        )
        return response.content[0].text

    def _call_litellm(self, messages: list[dict]) -> str:
        import openai
        import httpx

        client = openai.OpenAI(
            api_key=self.litellm_api_key,
            base_url=self.litellm_base_url,
            http_client=httpx.Client(verify=False),
        )
        response = client.chat.completions.create(
            model=self.model_id,
            messages=messages,
            max_tokens=self.max_new_tokens,
            temperature=self.temperature,
        )
        return response.choices[0].message.content

    def _call_watsonx(self, messages: list[dict]) -> str:
        """Call watsonx.ai, preferring the new SDK and falling back to the legacy one."""
        prompt = self._messages_to_text(messages)

        # New SDK: ibm_watsonx_ai
        try:
            from ibm_watsonx_ai import Credentials
            from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams
            from ibm_watsonx_ai.foundation_models.utils.enums import DecodingMethods
            from ibm_watsonx_ai.foundation_models import ModelInference

            parameters = {
                GenParams.MIN_NEW_TOKENS: 0,
                GenParams.MAX_NEW_TOKENS: self.max_new_tokens,
                GenParams.DECODING_METHOD: DecodingMethods.GREEDY,
                GenParams.REPETITION_PENALTY: 1,
                GenParams.STOP_SEQUENCES: ["<|endoftext|>"],
            }
            credentials = Credentials(url=WATSONX_URL, api_key=self.watsonx_api_key)
            model = ModelInference(
                model_id=self.model_id,
                params=parameters,
                credentials=credentials,
                project_id=self.watsonx_project_id,
            )
            response = model.generate_text(prompt=[prompt])
            return response[0]() if callable(response[0]) else response[0]
        except ImportError:
            pass

        # Legacy SDK: ibm_watson_machine_learning
        from ibm_watson_machine_learning.foundation_models import Model
        from ibm_watson_machine_learning.metanames import GenTextParamsMetaNames as GenParams

        parameters = {
            GenParams.MIN_NEW_TOKENS: 0,
            GenParams.MAX_NEW_TOKENS: self.max_new_tokens,
            GenParams.DECODING_METHOD: "greedy",
            GenParams.REPETITION_PENALTY: 1,
            GenParams.STOP_SEQUENCES: ["<|endoftext|>"],
        }
        model = Model(
            model_id=self.model_id,
            params=parameters,
            credentials={"url": WATSONX_URL, "apikey": self.watsonx_api_key},
            project_id=self.watsonx_project_id,
        )
        response = model.generate_text(prompt=[prompt])
        return response[0]() if callable(response[0]) else response[0]

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def call_llm(self, prompt: str, system_prompt: str = "", max_retries: int = 3) -> str:
        """Call the configured LLM and return the generated text.

        Transient errors are retried with exponential backoff. On unrecoverable
        failure an ``"Error calling LLM: ..."`` string is returned (callers can
        check for the ``Error`` prefix) rather than raising.
        """
        cache_key = "###".join([
            self.service,
            self.model_id,
            str(self.temperature),
            str(self.max_new_tokens),
            system_prompt,
            prompt,
        ])
        if self.use_cache and cache_key in LLMAgent._cache:
            return LLMAgent._cache[cache_key]

        messages = self._build_messages(prompt, system_prompt)
        dispatch = {
            "RITS": self._call_rits,
            "OPENAI": self._call_openai,
            "WATSONX": self._call_watsonx,
            "ANTHROPIC": self._call_anthropic,
            "LITELLM": self._call_litellm,
        }
        handler = dispatch.get(self.service)
        if handler is None:
            raise ValueError(f"Service {self.service} is not implemented.")

        last_error = None
        for attempt in range(max_retries):
            try:
                generated_text = handler(messages)
                final_text = (generated_text or "").strip()
                if self.use_cache and final_text:
                    LLMAgent._cache[cache_key] = final_text
                    LLMAgent._save_cache()
                return final_text
            except Exception as e:
                last_error = e
                if self._is_retryable_error(e) and attempt < max_retries - 1:
                    wait_time = 2 ** (attempt + 1)  # 2s, 4s, 8s
                    print(
                        f"[retry {attempt + 1}/{max_retries}] {type(e).__name__}: "
                        f"{str(e)[:120]} -- retrying in {wait_time}s"
                    )
                    time.sleep(wait_time)
                    continue
                print(f"Error calling {self.service} LLM: {type(e).__name__}")
                traceback.print_exc()
                return f"Error calling LLM: {str(e)}"

        return f"Error calling LLM after {max_retries} attempts: {str(last_error)}"

    # Convenience alias for message-style callers.
    def call(self, user_prompt: str, system_prompt: str = "", max_retries: int = 3) -> str:
        return self.call_llm(user_prompt, system_prompt=system_prompt, max_retries=max_retries)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Call an LLM through LLMAgent.")
    parser.add_argument("--service", default="RITS",
                        help="RITS | WATSONX | OPENAI | ANTHROPIC | LITELLM")
    parser.add_argument("--model_name", default="ibm/granite-3-2-8b-instruct")
    parser.add_argument("--temperature", type=float, default=0.25)
    parser.add_argument("--system", default="")
    parser.add_argument("--prompt", default="What is 2 + 2?")
    args = parser.parse_args()

    agent = LLMAgent(
        service=args.service,
        model_name=args.model_name,
        temperature=args.temperature,
    )
    print("LLM output:", agent.call_llm(args.prompt, system_prompt=args.system))
