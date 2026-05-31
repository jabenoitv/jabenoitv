# BBQ Smoking Time Calculator 🔥

Una calculadora moderna para estimar tiempo de cocción vs temperatura en ahumado de carnes, inspirada en el modelo de terneza de SmokeTrails BBQ.

## Características

- **Múltiples tipos de carne**: Brisket, Pork Butt, Ribs, Chicken, Turkey, etc.
- **Conversión flexible**: Entrada de peso en kg o lbs
- **Temperatura adaptable**: Entrada en °F o °C
- **Cálculos precisos**: Fórmulas basadas en ratios de cocción BBQ tradicionales
- **Progresión visual**: Gráfico interactivo mostrando la progresión de temperatura interna
- **Recomendaciones**: Tiempos de reposo (holding) y consejos prácticos
- **Diseño responsivo**: Funciona perfectamente en móvil y desktop

## Stack Tecnológico

- **React 18** - Framework UI
- **TypeScript** - Type safety
- **Vite** - Build tool rápido
- **CSS3** - Estilos modernos con gradientes y animaciones

## Instalación

```bash
cd bbq-calculator
npm install
```

## Desarrollo

```bash
npm run dev
```

La app se abrirá en `http://localhost:3000`

## Build

```bash
npm run build
```

Esto genera la carpeta `dist/` lista para Netlify o cualquier hosting estático.

## Despliegue en Netlify

1. Conecta tu repositorio GitHub a Netlify
2. Configura:
   - **Base directory**: `bbq-calculator`
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
3. Deploy automático en cada push

## Fórmulas de Cálculo

### Tiempo de Cocción
- **Brisket**: 1.5 horas/libra
- **Pork Butt/Shoulder**: 2 horas/libra
- **Ribs**: 0.5 horas/libra
- **Beef Ribs**: 1.25 horas/libra
- **Chicken**: 0.75 horas/libra
- **Turkey**: 0.75 horas/libra

### Temperatura Interna Recomendada
- **Carnes rojas**: 190-205°F
- **Carnes blancas**: 165°F

### Ajuste por Temperatura
El tiempo se ajusta automáticamente según la temperatura de ahumado:
- Temperaturas más altas = tiempos más cortos
- Temperaturas más bajas = tiempos más largos

## Características en Detalle

### Conversión de Unidades
- Alterna entre kg/lbs con un clic
- Alterna entre °F/°C automáticamente
- Conversiones en tiempo real

### Gráfico de Progresión
Visualiza cómo progresa la temperatura interna de la carne:
- Rojo: Cocimiento temprano
- Amarillo: Cocimiento avanzado
- Verde: Casi listo
- Azul: Listo

### Tiempo de Reposo
Recomendaciones para mantener la carne a 140°F tras cocción:
- Mejora la distribución de jugos
- Previene pérdida de humedad
- Facilita el corte

## Tips BBQ

✓ Usa un termómetro de carne confiable
✓ El wrap a 165°F acelera cocción
✓ Factores como viento afectan tiempos
✓ Reposa en caja aislante
✓ Mantén temperatura consistente

## Autor

Inspirado en SmokeTrails BBQ y mejores prácticas de pitmaster.

## Licencia

MIT
