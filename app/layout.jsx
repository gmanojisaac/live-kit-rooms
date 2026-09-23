import './globals.css';

export const metadata = {
  title: 'Live Meet — LiveKit Collaborative Rooms',
  description: 'Private collaborative video meetings and real-time screen sharing with LiveKit',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#202124" />
      </head>
      <body>{children}</body>
    </html>
  );
}
