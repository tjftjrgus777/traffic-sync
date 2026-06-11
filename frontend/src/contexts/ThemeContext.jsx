import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({ light: false, toggleTheme: () => {} })

export function ThemeProvider({ children }) {
  const [light, setLight] = useState(() => localStorage.getItem('ts_light') === '1')

  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : ''
    localStorage.setItem('ts_light', light ? '1' : '0')
  }, [light])

  const toggleTheme = () => setLight(v => !v)

  return (
    <ThemeContext.Provider value={{ light, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
