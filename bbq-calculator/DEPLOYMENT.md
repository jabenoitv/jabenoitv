# 🚀 Guía de Deployamiento a Netlify

La calculadora BBQ está lista para ser deployada a **Netlify** en minutos.

## Opción 1: Deploy Directo desde GitHub (RECOMENDADO)

### Requisitos:
- Cuenta en [Netlify](https://netlify.com) (gratis)
- Acceso al repositorio GitHub `jabenoitv/jabenoitv`
- Rama: `claude/bbq-smoking-calculator-dFRHM`

### Pasos:

1. **Ir a Netlify**
   ```
   https://app.netlify.com
   ```
   - Login con GitHub

2. **Crear nuevo sitio**
   - Click: "Add new site" → "Import an existing project"
   - Seleccionar: `jabenoitv/jabenoitv`
   - Confirmar

3. **Configurar build**
   - **Base directory:** `bbq-calculator`
   - **Build command:** (dejar vacío - no necesita build)
   - **Publish directory:** `.` (raíz de bbq-calculator)

4. **Avanzado**
   - Dejar defaults
   - Click: "Deploy site"

5. **¡Listo!**
   - Netlify genera URL automática: `https://[nombre-random].netlify.app`
   - Deploy automático en cada push a `claude/bbq-smoking-calculator-dFRHM`

---

## Opción 2: Deploy Manual (sin GitHub)

Si prefieres no usar GitHub:

### 1. Descargar archivos
```bash
# En tu computadora
cd ~/Downloads
git clone https://github.com/jabenoitv/jabenoitv.git
cd jabenoitv/bbq-calculator
```

### 2. Instalar Netlify CLI (opcional)
```bash
npm install -g netlify-cli
```

### 3. Deploy
```bash
netlify deploy --dir=.
```

Netlify te pedirá:
- Autorizar cuenta
- Crear nuevo sitio
- Confirmar publish directory

---

## Opción 3: Drag & Drop (Más simple)

1. Ir a https://app.netlify.com/drop
2. Arrastra la carpeta `bbq-calculator` completa
3. ¡Deploy instantáneo!

---

## Después del Deploy

### Configurar dominio personalizado (opcional)
En Netlify → Site settings → Domain management:
- Cambiar nombre de sitio
- O conectar dominio propio (tudominio.com)

### Activer HTTPS
Automático en todos los sitios Netlify ✓

### Monitorar
- Analytics en dashboard
- Logs en "Deploys"

---

## Estructura Deployada

```
https://tu-sitio.netlify.app/
├── index.html          ← La app BBQ (todo en 1 archivo)
├── netlify.toml        ← Config (oculto)
├── README.md           ← Este archivo
├── package.json        ← Metadata
└── DEPLOYMENT.md       ← Instrucciones
```

---

## Características Post-Deploy

✅ **Funciona offline:** LocalStorage persiste
✅ **Responsive:** Perfecta en móvil
✅ **Rápida:** CDN global de Netlify
✅ **HTTPS:** Seguro por defecto
✅ **SPA:** Navegación suave

---

## Troubleshooting

### "Cannot find index.html"
- Verificar: **Publish directory** = `.` (no `dist`)
- Verificar: **Base directory** = `bbq-calculator`

### "Página blanca al cargar"
- Abrir DevTools (F12)
- Ver console por errores
- Verificar MIME type de index.html

### "Deploy lento"
- Netlify cachea automáticamente
- Primer deploy: ~30s
- Siguientes: <5s

---

## Actualizaciones

Cada vez que hagas push a `claude/bbq-smoking-calculator-dFRHM`:
1. GitHub avisa a Netlify
2. Netlify redeploy automático
3. Sitio actualizado en ~30s

---

## Enlace Generado

Una vez deployado, compartir:
```
https://[tu-nombre-netlify].netlify.app
```

Ejemplo:
```
https://bbq-calculator-pro.netlify.app
```

---

¡Listo para usar desde cualquier dispositivo! 🔥
