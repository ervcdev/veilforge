import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jet",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "VeilForge | Blockchain Dashboard",
  description: "Real-time blockchain trading dashboard with MEV protection",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <body 
        className={`${jetBrainsMono.variable} antialiased`}
        style={{ 
          background: '#0a0a0f', 
          color: '#ffffff',
          minHeight: '100vh'
        }}
      >
        {children}
      </body>
    </html>
  );
}
