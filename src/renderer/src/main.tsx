import { createRoot } from 'react-dom/client'
import App from './App'
import '@xterm/xterm/css/xterm.css'
import 'react-grid-layout/css/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
