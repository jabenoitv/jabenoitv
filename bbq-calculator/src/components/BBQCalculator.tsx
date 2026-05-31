import React, { useState } from 'react'
import {
  calculateCookingTime,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  MEAT_TYPES,
  type MeatType,
  type CookingResult,
} from '../utils/bbqFormulas'
import './BBQCalculator.css'

export function BBQCalculator() {
  const [meatType, setMeatType] = useState<MeatType>('brisket')
  const [weight, setWeight] = useState<number>(5)
  const [isKg, setIsKg] = useState<boolean>(false)
  const [tempUnit, setTempUnit] = useState<'F' | 'C'>('F')
  const [smokingTemp, setSmokingTemp] = useState<number>(225)
  const [result, setResult] = useState<CookingResult | null>(null)

  const handleCalculate = () => {
    const tempF = tempUnit === 'C' ? celsiusToFahrenheit(smokingTemp) : smokingTemp
    const calculatedResult = calculateCookingTime(meatType, weight, isKg, tempF)
    setResult(calculatedResult)
  }

  const handleWeightUnitChange = () => {
    setIsKg(!isKg)
    if (!isKg) {
      setWeight(Math.round(weight * 0.453592 * 10) / 10)
    } else {
      setWeight(Math.round(weight * 2.20462 * 10) / 10)
    }
  }

  const displayTemp = tempUnit === 'F' ? smokingTemp : fahrenheitToCelsius(smokingTemp)

  return (
    <div className="calculator-container">
      <h1>🔥 BBQ Smoking Calculator</h1>
      <p className="subtitle">Calcula tiempo y temperatura para tu ahumado perfecto</p>

      <div className="input-section">
        <div className="form-group">
          <label htmlFor="meatType">Tipo de Carne</label>
          <select
            id="meatType"
            value={meatType}
            onChange={(e) => setMeatType(e.target.value as MeatType)}
          >
            {MEAT_TYPES.map((meat) => (
              <option key={meat.value} value={meat.value}>
                {meat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group weight-group">
          <label htmlFor="weight">Peso</label>
          <div className="weight-input-group">
            <input
              id="weight"
              type="number"
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
              min="0.1"
              step="0.1"
            />
            <button className="unit-toggle" onClick={handleWeightUnitChange} title="Cambiar unidad">
              {isKg ? 'kg' : 'lbs'}
            </button>
          </div>
        </div>

        <div className="form-group temp-group">
          <label htmlFor="smokingTemp">Temperatura de Ahumado</label>
          <div className="temp-input-group">
            <input
              id="smokingTemp"
              type="number"
              value={displayTemp}
              onChange={(e) => setSmokingTemp(parseFloat(e.target.value) || 0)}
              min="150"
              max="350"
              step="5"
            />
            <button className="unit-toggle" onClick={() => setTempUnit(tempUnit === 'F' ? 'C' : 'F')}>
              °{tempUnit}
            </button>
          </div>
        </div>

        <button className="calculate-btn" onClick={handleCalculate}>
          Calcular
        </button>
      </div>

      {result && (
        <div className="results-section">
          <div className="result-header">
            <h2>{result.meatName}</h2>
            <p className="result-weight">
              {result.weightLbs} lbs ({result.weightKg} kg) • {result.smokingTemp}°F
            </p>
          </div>

          <div className="result-cards">
            <div className="card primary">
              <h3>Tiempo de Cocción</h3>
              <div className="time-display">
                <span className="hours">{result.estimatedCookingTimeHours}h</span>
                <span className="minutes">
                  {result.estimatedCookingTimeMinutes % 60}m
                </span>
              </div>
              <p className="note">Tiempo aproximado de ahumado</p>
            </div>

            <div className="card">
              <h3>Rango de Temperatura Interna</h3>
              <div className="temp-range">
                <p>Mínima: <strong>{result.minInternalTemp}°F</strong></p>
                <p>Óptima: <strong>{result.optimalInternalTemp}°F</strong></p>
              </div>
            </div>

            <div className="card">
              <h3>Tiempo de Reposo (Holding)</h3>
              <div className="holding-time">
                <span className="duration">{result.holdingDuration} min</span>
              </div>
              <p className="note">Mantener a 140°F después de cocción</p>
            </div>
          </div>

          <div className="temperature-chart">
            <h3>Progresión de Temperatura Interna</h3>
            <div className="chart-container">
              <div className="bars">
                {result.temperatureRange.map((item, index) => {
                  const percentage = ((item.temp - result.minInternalTemp) /
                    (result.optimalInternalTemp - result.minInternalTemp)) * 100
                  return (
                    <div key={index} className="bar-item">
                      <div
                        className="bar"
                        style={{
                          height: `${Math.max(percentage, 5)}%`,
                          background: getColorForTemp(item.temp, result.optimalInternalTemp),
                        }}
                      />
                      <span className="temp-label">{item.temp}°F</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="stages">
              {result.temperatureRange.map((item, index) => (
                <div key={index} className="stage-item">
                  <span className="stage-temp">{item.temp}°F:</span>
                  <span className="stage-name">{item.stage}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="tips-section">
            <h3>💡 Consejos</h3>
            <ul>
              <li>Usa un termómetro de carne confiable para verificar la temperatura interna</li>
              <li>El "wrap" con papel aluminio a los 165°F acelera la cocción y previene resecamiento</li>
              <li>Los tiempos son aproximados; factores como viento y humedad afectan la cocción</li>
              <li>Reposa la carne en una caja de aislante a 140°F para distribuir jugos</li>
              <li>Mantén la temperatura consistente durante todo el ahumado</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function getColorForTemp(temp: number, optimalTemp: number): string {
  const percentage = (temp / optimalTemp) * 100
  if (percentage < 50) return '#FF6B6B'
  if (percentage < 75) return '#FFD93D'
  if (percentage < 90) return '#6BCB77'
  return '#4D96FF'
}
