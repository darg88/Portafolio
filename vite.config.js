import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  return {
    // CONDICIONAL INTELIGENTE:
    // Si el comando es 'build' (lo que usa GitHub Actions), usa la ruta de tu repositorio.
    // De lo contrario (cuando usas 'npm run dev' localmente), usa la ruta raíz '/'.
    base: command === 'build' ? '/Portafolio/' : '/',
  }
})