import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: "AAP Admin — Aam Aadmi Party, Chhattisgarh",
  description: "Aam Aadmi Party Chhattisgarh — Organization Management Dashboard",
  icons: {
    icon: "/favicon.jpg",
    shortcut: "/favicon.jpg",
    apple: "/favicon.jpg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0B3A82",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} font-sans h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before paint to avoid a light/dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-white text-gray-900 font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
