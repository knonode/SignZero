import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'info' | 'success' | 'error' | 'loading'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => number
  removeToast: (id: number) => void
  updateToast: (id: number, message: string, type?: ToastType, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const scheduleRemoval = useCallback((id: number, duration: number) => {
    const existing = timersRef.current.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      timersRef.current.delete(id)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
    timersRef.current.set(id, timer)
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = ++nextId
    setToasts((prev) => [...prev, { id, message, type }])
    const autoDismiss = type === 'loading' ? 0 : (duration ?? 4000)
    if (autoDismiss > 0) {
      scheduleRemoval(id, autoDismiss)
    }
    return id
  }, [scheduleRemoval])

  const updateToast = useCallback((id: number, message: string, type?: ToastType, duration?: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, message, type: type ?? t.type } : t))
    )
    const newType = type
    const autoDismiss = newType === 'loading' ? 0 : (duration ?? 4000)
    if (autoDismiss > 0) {
      scheduleRemoval(id, autoDismiss)
    } else {
      const existing = timersRef.current.get(id)
      if (existing) {
        clearTimeout(existing)
        timersRef.current.delete(id)
      }
    }
  }, [scheduleRemoval])

  return (
    <ToastContext.Provider value={{ addToast, removeToast, updateToast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 border text-sm animate-[slideIn_0.2s_ease-out] ${getToastStyles(toast.type)}`}
            >
              <span className="shrink-0 mt-0.5">{getToastIcon(toast.type)}</span>
              <span className="flex-1 min-w-0">{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2"
              >
                x
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function getToastStyles(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'bg-[var(--bg-surface)] border-[var(--accent-green)] text-[var(--text-primary)]'
    case 'error':
      return 'bg-[var(--bg-surface)] border-[var(--accent-red)] text-[var(--accent-red)]'
    case 'loading':
      return 'bg-[var(--bg-surface)] border-[var(--accent-cyan)] text-[var(--text-primary)]'
    default:
      return 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-primary)]'
  }
}

function getToastIcon(type: ToastType): string {
  switch (type) {
    case 'success':
      return '\u2713'
    case 'error':
      return '!'
    case 'loading':
      return '\u25CB'
    default:
      return '\u2022'
  }
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
