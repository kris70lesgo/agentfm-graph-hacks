import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setApiPort } from './lib/api'
import GraphContext from './routes/GraphContext'
import { ArrowUpRight, Boxes, ShieldCheck } from 'lucide-react'
import './styles/globals.css'

const requestedPort = Number(new URLSearchParams(window.location.search).get('apiPort') || 8080)
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 8080
setApiPort(port)
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-editor text-text-0">
        <header className="border-b border-border-1 bg-chrome/90">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <a href="/demo.html" className="flex items-center gap-3 text-inherit no-underline">
              <span className="grid h-9 w-9 place-items-center rounded-md border border-accent/35 bg-accent/10 text-accent"><Boxes size={18} /></span>
              <span>
                <span className="block text-sm font-semibold tracking-tight">Warp <span className="font-normal text-text-2">/ Graph Context</span></span>
                <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-text-2">FalkorDB · Graph Hacks</span>
              </span>
            </a>
            <nav className="flex items-center gap-2" aria-label="Demo gateways">
              <span className="mr-1 hidden items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-text-2 sm:flex"><ShieldCheck size={13} /> Private mesh</span>
              {[8080, 8081].map((gateway, i) => (
                <a
                  key={gateway}
                  href={`/demo.html?apiPort=${gateway}`}
                  aria-current={port === gateway ? 'page' : undefined}
                  className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${port === gateway ? 'border-accent/45 bg-accent/10 text-accent' : 'border-border-1 text-text-1 hover:bg-white/[0.045] hover:text-text-0'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${port === gateway ? 'bg-accent' : 'bg-text-3'}`} />
                  Boss {i === 0 ? 'A' : 'B'} <span className="font-mono text-[10px] opacity-75">:{gateway}</span>
                </a>
              ))}
            </nav>
          </div>
        </header>
        <GraphContext />
        <footer className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-6 text-xs text-text-2 sm:px-6 lg:px-8">
          <span>Atlas and Nova run deterministic planning code in real containers. No LLM or paid API is used.</span>
          <a className="inline-flex items-center gap-1.5 text-text-1 hover:text-accent" href="https://github.com/kris70lesgo/warpg" target="_blank" rel="noreferrer">Warp source <ArrowUpRight size={12} /></a>
        </footer>
      </div>
    </QueryClientProvider>
  </React.StrictMode>,
)
