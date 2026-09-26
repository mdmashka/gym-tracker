# Gym Tracker iOS

Native iOS shell around the existing React/Vite Gym Tracker web app.

Telegram is not replaced or modified: the same web build continues to use Telegram APIs only when window.Telegram.WebApp exists. The iOS shell loads the production Vercel app in WKWebView, so Telegram BackButton, haptics, initData and menu-button setup remain Telegram-only.

Important: outside Telegram the current web app intentionally uses local storage. This first iOS shell therefore does not impersonate Telegram authentication or bypass the existing Supabase endpoint. Shared Telegram+iOS account sync should be added as a separate iOS authentication path before public release.

Update productionURL in ContentView.swift if the Vercel production domain changes.
