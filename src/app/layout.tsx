import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'JAIS Command Ops',
  description: 'OpenClaw Agent Orchestration Dashboard',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'JAIS Command Ops',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="h-screen overflow-hidden bg-background text-foreground">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
