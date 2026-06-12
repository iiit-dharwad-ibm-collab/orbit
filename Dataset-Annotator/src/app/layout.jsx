import "./globals.css";

export const metadata = {
  title: "Dataset Generator",
  description: "Build high-quality ITOps training data",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
