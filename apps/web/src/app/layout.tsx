import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const jetbrainsMono = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Variable.woff2', style: 'normal' },
    { path: './fonts/JetBrainsMono-Italic-Variable.woff2', style: 'italic' },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const plusJakartaSans = localFont({
  src: [
    { path: './fonts/PlusJakartaSans-Variable.woff2', style: 'normal' },
    { path: './fonts/PlusJakartaSans-Italic-Variable.woff2', style: 'italic' },
  ],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CollabMD',
  description: 'Collaborative markdown editing for everyone',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${plusJakartaSans.variable}`}>
      <body>{children}</body>
    </html>
  )
}
