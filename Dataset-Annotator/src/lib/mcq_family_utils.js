// Client-side helpers for the MCP Studio: planning variant option orders and batching.

export const CONCEPT_ROLES = [
  { id: "cause", correct: true, hint: "Diagnosis the evidence supports" },
  { id: "fix", correct: true, hint: "Correct remediation via declared config" },
  { id: "check", correct: true, hint: "Check that confirms the diagnosis" },
  { id: "verify", correct: true, hint: "Recovery check proving the fix" },
  { id: "original_proposal", correct: false, hint: "Tempting first instinct the evidence rules out" },
  { id: "misconception_1", correct: false, hint: "Plausible but wrong" },
  { id: "misconception_2", correct: false, hint: "Plausible but wrong" },
  { id: "misconception_3", correct: false, hint: "Plausible but wrong" },
];

export function chunk(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
}

// Small seeded PRNG so a plan can be regenerated identically from its seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Plans `count` unique option subsets/orders from the pool. Every variant keeps
 * at least 2 correct and 1 incorrect option so it stays a real multi-select.
 */
export function planVariants(options, { count = 10, minSize = 6, maxSize = 7, seed = 1 } = {}) {
  const correct = options.filter((o) => o.is_correct).map((o) => o.concept_id);
  const incorrect = options.filter((o) => !o.is_correct).map((o) => o.concept_id);
  if (correct.length < 2 || incorrect.length < 1) {
    throw new Error("Pool needs at least 2 correct and 1 incorrect option");
  }
  const lo = Math.max(3, Math.min(minSize, options.length));
  const hi = Math.max(lo, Math.min(maxSize, options.length));

  const rand = mulberry32(seed);
  const seen = new Set();
  const plans = [];
  let attempts = 0;
  while (plans.length < count && attempts < count * 200) {
    attempts++;
    const size = lo + Math.floor(rand() * (hi - lo + 1));
    const nCorrect = 2 + Math.floor(rand() * (Math.min(correct.length, size - 1) - 1));
    const nIncorrect = size - nCorrect;
    if (nIncorrect < 1 || nIncorrect > incorrect.length) continue;
    const picked = [...shuffle(correct, rand).slice(0, nCorrect), ...shuffle(incorrect, rand).slice(0, nIncorrect)];
    const order = shuffle(picked, rand);
    const key = order.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(order);
  }
  return plans;
}

export function formatQuestionId(prefix, n, pad = 4) {
  return `${prefix}${String(n).padStart(pad, "0")}`;
}

// "1-20, 25, 30-32" -> [1..20, 25, 30, 31, 32]
export function parseIdRange(text, limit = 500) {
  const ids = new Set();
  for (const part of String(text || "").split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && ids.size < limit; i++) ids.add(i);
  }
  return [...ids];
}

export const SAMPLE_FAMILY = {
  family_id: "DEMO-F001",
  title: "Healthy pods behind a silent Service",
  domain: "Kubernetes",
  source_cluster_id: "SC-01",
  user_prompt: "I'm on call for our Kubernetes platform and requests to the checkout Service are failing from a client pod, even though the checkout pods look healthy. Before anyone starts restarting things, I want to understand what is actually broken and how we should fix and verify it. Here's what I've confirmed so far.",
  evidence: [
    { id: "E1", observation: "DNS resolves checkout to its expected ClusterIP." },
    { id: "E2", observation: "Requests to each pod IP on TCP 8080 succeed from the affected client pod." },
    { id: "E3", observation: "The Service selects app=checkout-v1, but every serving pod is labelled app=checkout-v2; its EndpointSlice has no endpoints." },
    { id: "E4", observation: "No NetworkPolicy changed and there are no container restarts." },
  ],
  grounding: [
    {
      type: "official_project_documentation",
      title: "Kubernetes — Debug Services",
      url: "https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/",
    },
  ],
  options: [
    { concept_id: "cause", is_correct: true, text: "The Service selector does not match the serving pods' labels, so the Service has no backend endpoints even though the pods are healthy.", explanation: "E3 shows the selector/label mismatch and an empty EndpointSlice; E1 and E2 rule out DNS and the application." },
    { concept_id: "fix", is_correct: true, text: "Correct the selector in the declared configuration to the intended release labels, or restore the intended labels; reconcile and check the resulting endpoints.", explanation: "This addresses the supported mechanism while keeping the stated constraints." },
    { concept_id: "check", is_correct: true, text: "Compare the live Service selector with pod labels and EndpointSlices in the same namespace; expect zero selected pods despite healthy direct endpoints.", explanation: "Confirms the diagnosis before acting, using the exact objects named in E3." },
    { concept_id: "verify", is_correct: true, text: "Recovery review: EndpointSlices contain the intended ready pod addresses; ClusterIP and DNS-name requests from the original client succeed repeatedly.", explanation: "Tests the intended correction on the same path that was failing, not just a transient symptom." },
    { concept_id: "original_proposal", is_correct: false, text: "Restart CoreDNS because Service-name requests time out.", explanation: "Resolution already returns the correct IP (E1); restarting DNS cannot populate EndpointSlices." },
    { concept_id: "misconception_1", is_correct: false, text: "The successful DNS lookup establishes that the Service has discovered its backend pods; investigate application response time first.", explanation: "DNS maps the Service name to its IP, not to a guarantee of populated backend endpoints." },
    { concept_id: "misconception_2", is_correct: false, text: "Changing targetPort to 8080 is sufficient to restore this Service even while its selector matches none of the serving pods.", explanation: "A correct port cannot forward traffic to an empty backend set." },
    { concept_id: "misconception_3", is_correct: false, text: "Recovery review: healthy responses from direct pod IPs are sufficient recovery evidence, so the ClusterIP path needs no separate test.", explanation: "Direct requests bypass the failed Service selection and forwarding path." },
  ],
};
