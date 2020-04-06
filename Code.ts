/**
 * A Google App Script to manage Animal Crossing New Horizon's Stalk Market predictions
 *
 * @name google-sheets-stalk-market-calculator
 * @version 2.0.0
 *
 * Original Reverse Engineering done by Treeki
 * https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b
 * https://twitter.com/_Ninji/status/1244818665851289602
 *
 * Conversion to Javascript by Mike Bryant
 * https://twitter.com/LeaChimUK/status/1245078620948828161
 * https://mikebryant.github.io/ac-nh-turnip-prices/index.html
 *
 * Original Google App Script implementation by the following
 * @author Matthew Conto <https://github.com/drfuzzyness>
 * @author Jeffrey Hu <https://github.com/jyh947>
 * @author Jonathan Ames <>
 *
 * Heavily modified for multiple users & including probable price
 * @author Chris Gamble <https://github.com/Fugiman>
 *
 * This script predicts a range of stock prices for times you don't have data for. It can handle any
 * amount of missing data, but the more you have the more accurate it will be. Output is in the format
 * of "<lowest possible price>-<most likely price>-<highest possible price>".
 *
 * To get the "most likely price" and to not rely on any random state, this script brute forces each possible
 * series of prices and removes the ones that don't match the data you've entered. This can be pretty slow.
 */

// Triggers whenever ANY cell is modified.
// We ensure the sheet has [calc] in the name to allow you to store other data in the spreadsheet
function onEdit(edit: GoogleAppsScript.Events.SheetsOnEdit) {
  const sheetName = edit.range.getSheet().getName()
  if (sheetName.includes('[calc]')) {
    updateSheet(edit.range)
  }
}
// The simple trigger of onEdit didn't seem to be working, so I manually made another trigger to wrap it for my sheet
// If you're having issues, this might be the fix
function _onEdit(edit: GoogleAppsScript.Events.SheetsOnEdit) {
  onEdit(edit)
}

// Does the data extraction and formatting of results
function updateSheet(range: GoogleAppsScript.Spreadsheet.Range) {
  // This part extracts data from the sheet, assuming a very specific format
  // If you change the format of the sheet please update this part!
  // You'll also need to update the part below if you change the structure
  // of how AM/PM prices are entered
  const sheet = range.getSheet()
  const row = range.getRow() - (range.getRow() % 2) // Round down to nearest multiple of 2

  // Get manually entered buy/sell prices
  const sellRange = sheet.getRange(row, 4, 2, 6)
  let buyPrice: number | null = Number(sheet.getRange(row, 2).getValue())
  buyPrice = buyPrice < 90 || buyPrice > 110 ? null : buyPrice // Sanitize buyPrice
  const sellPrices = [buyPrice || 90, buyPrice || 110]
  const sellValues = sellRange.getValues()
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 2; row++) {
      sellPrices.push(Number(sellValues[row][col] || 'NaN'))
    }
  }

  // Generate prediction off of sellPrices
  let prediction = mergePredictions([generatePatternZero(sellPrices), generatePatternOne(sellPrices), generatePatternTwo(sellPrices), generatePatternThree(sellPrices)])

  // Normalize prediction probabilities
  for (let estimates of prediction) {
    let mul = 1.0 / estimates.map(p => p.probability).reduce((a, b) => a + b, 0)
    for (let e of estimates) {
      e.probability *= mul
    }
  }

  // For each cell set the value based on prediction
  let results: string[] = []
  sellPrices.slice(2).forEach((v, idx) => {
    const cell = sellRange.getCell(1 + (idx % 2), 1 + Math.floor(idx / 2))
    const estimates = prediction[idx + 2]
    if (!isNaN(v)) {
      results.push(`${v}`)
      cell.setFontColor('#000')
      cell.setFontStyle('normal')
    } else if (!estimates) {
      results.push('')
      cell.setValue('')
    } else {
      const min = Math.min(...estimates.map(e => e.price))
      const max = Math.max(...estimates.map(e => e.price))
      // This one is a bit weird and I am likely getting the math wrong
      const probable = estimates.reduce((a, b) => a + b.price * b.probability, 0).toFixed(0)

      const value = isFinite(min) && isFinite(max) ? `${min}-${probable}-${max}` : ''
      results.push(value)
      cell.setValue(value)
      cell.setFontColor('#999')
      cell.setFontStyle('italic')
    }
  })

  // Handy for debugging why the script isn't working
  console.log({ sellPrices, results })
}

type Prediction = Estimate[][] // outer array is time periods, inner array is prices for that time period
interface Estimate {
  price: number // Always an integer, except for where we abuse this type to also handle rates
  probability: number // All probabilities in the same time period should add up to 1
}

function generatePatternZero(given_prices: number[]): Prediction {
  let prediction: Prediction = []
  const probability1 = 0.346 // Acquired by GetPatternProbabilities

  for (let dec_phase_1_len = 2; dec_phase_1_len < 4; dec_phase_1_len++) {
    const probability2 = probability1 / 2
    const dec_phase_2_len = 5 - dec_phase_1_len
    const dec_rates_1 = generateRates(0.6, 0.8, 0.04, 0.1, dec_phase_1_len)
    const dec_rates_2 = generateRates(0.6, 0.8, 0.04, 0.1, dec_phase_2_len)
    for (let high_phase_1_len = 0; high_phase_1_len < 7; high_phase_1_len++) {
      const probability3 = probability2 / 7
      for (let high_phase_3_len = 0; high_phase_3_len < 7 - high_phase_1_len; high_phase_3_len++) {
        const probability4 = probability3 / (7 - high_phase_1_len)

        prediction = mergePredictions([
          prediction,
          generatePatternZeroWithLengths(
            given_prices,
            high_phase_1_len,
            dec_phase_1_len,
            7 - high_phase_1_len - high_phase_3_len,
            5 - dec_phase_1_len,
            high_phase_3_len,
            dec_rates_1,
            dec_rates_2,
            probability4,
          ),
        ])
      }
    }
  }

  return prediction
}

function generatePatternOne(given_prices: number[]): Prediction {
  let prediction: Prediction = []
  const probability1 = 0.248

  for (let peak_start = 3; peak_start < 10; peak_start++) {
    const probability2 = probability1 / 7
    const rates = generateRates(0.85, 0.9, 0.03, 0.05, peak_start - 2)

    prediction = mergePredictions([prediction, generatePatternOneWithPeak(given_prices, peak_start, rates, probability2)])
  }

  return prediction
}

function generatePatternTwo(given_prices: number[]): Prediction {
  let prediction: Prediction = []
  const probability1 = 0.1475

  const rates = generateRates(0.85, 0.9, 0.03, 0.05, 12)
  prediction = generatePatternTwoWithRates(given_prices, rates, probability1)

  return prediction
}

function generatePatternThree(given_prices: number[]): Prediction {
  let prediction: Prediction = []
  const probability1 = 0.2585

  for (let peak_start = 2; peak_start < 10; peak_start++) {
    const probability2 = probability1 / 8
    const dec_rates_1 = generateRates(0.4, 0.9, 0.03, 0.05, peak_start - 2)
    const dec_rates_2 = generateRates(0.4, 0.9, 0.03, 0.05, 9 - peak_start)

    for (let spikeRate = 1.4; spikeRate <= 2.001; spikeRate += 0.05) {
      const probability3 = probability2 / 13

      prediction = mergePredictions([prediction, generatePatternThreeWithPeak(given_prices, peak_start, spikeRate, dec_rates_1, dec_rates_2, probability3)])
    }
  }

  return prediction
}

function generatePatternZeroWithLengths(
  given_prices: number[],
  high_phase_1_len: number,
  dec_phase_1_len: number,
  high_phase_2_len: number,
  dec_phase_2_len: number,
  high_phase_3_len: number,
  dec_phase_1_rates: Prediction,
  dec_phase_2_rates: Prediction,
  probability: number,
): Prediction {
  let predicted_prices: Prediction = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  // High Phase 1
  for (let i = 2; i < 2 + high_phase_1_len; i++) {
    let min_pred = Math.floor(0.9 * given_prices[0])
    let max_pred = Math.ceil(1.4 * given_prices[1])

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }

  // Dec Phase 1
  for (let i = 2 + high_phase_1_len, j = 0; i < 2 + high_phase_1_len + dec_phase_1_len; i++, j++) {
    let estimates = multiplyEstimates(dec_phase_1_rates[j], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  // High Phase 2
  for (let i = 2 + high_phase_1_len + dec_phase_1_len; i < 2 + high_phase_1_len + dec_phase_1_len + high_phase_2_len; i++) {
    let min_pred = Math.floor(0.9 * given_prices[0])
    let max_pred = Math.ceil(1.4 * given_prices[1])
    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }

  // Dec Phase 2
  for (let i = 2 + high_phase_1_len + dec_phase_1_len + high_phase_2_len, j = 0; i < 2 + high_phase_1_len + dec_phase_1_len + high_phase_2_len + dec_phase_2_len; i++, j++) {
    let estimates = multiplyEstimates(dec_phase_2_rates[j], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  // High Phase 3
  if (2 + high_phase_1_len + dec_phase_1_len + high_phase_2_len + dec_phase_2_len + high_phase_3_len != 14) {
    throw new Error("Phase lengths don't add up")
  }
  for (let i = 2 + high_phase_1_len + dec_phase_1_len + high_phase_2_len + dec_phase_2_len; i < 14; i++) {
    let min_pred = Math.floor(0.9 * given_prices[0])
    let max_pred = Math.ceil(1.4 * given_prices[1])
    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }
  return predicted_prices
}

function generatePatternOneWithPeak(given_prices: number[], peak_start: number, rates: Prediction, probability: number): Prediction {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < peak_start; i++) {
    let estimates = multiplyEstimates(rates[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  // Now each day is independent of next
  let min_randoms = [0.9, 1.4, 2.0, 1.4, 0.9, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]
  let max_randoms = [1.4, 2.0, 6.0, 2.0, 1.4, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]
  for (let i = peak_start; i < 14; i++) {
    let min_pred = Math.floor(min_randoms[i - peak_start] * given_prices[0])
    let max_pred = Math.ceil(max_randoms[i - peak_start] * given_prices[1])

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }
  return predicted_prices
}

function generatePatternTwoWithRates(given_prices: number[], rates: Prediction, probability: number): Prediction {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < 14; i++) {
    let estimates = multiplyEstimates(rates[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  return predicted_prices
}

function generatePatternThreeWithPeak(
  given_prices: number[],
  peak_start: number,
  spike_rate: number,
  dec_rates_1: Prediction,
  dec_rates_2: Prediction,
  probability: number,
): Prediction {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < peak_start; i++) {
    let estimates = multiplyEstimates(dec_rates_1[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  // The peak
  for (let i = peak_start; i < peak_start + 2; i++) {
    let min_pred = Math.floor(0.9 * given_prices[0])
    let max_pred = Math.ceil(1.4 * given_prices[1])
    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }

  for (let i = peak_start + 2; i < peak_start + 5; i++) {
    let min_pred = Math.floor((i === peak_start + 3 ? spike_rate : 1.4) * given_prices[0]) - 1
    let max_pred = Math.ceil(spike_rate * given_prices[1])
    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }

  for (let i = peak_start + 5, j = 0; i < 14; i++, j++) {
    let estimates = multiplyEstimates(dec_rates_2[j], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return []
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  return predicted_prices
}

function priceRange(min: number, max: number, probability: number): Estimate[] {
  const length = max - min + 1
  const ret: Estimate[] = []
  for (let p = min; p <= max; p++) {
    ret.push({
      price: p,
      probability: probability / length,
    })
  }
  return ret
}

function generateRates(startMin: number, startMax: number, incrMin: number, incrMax: number, length: number): Prediction {
  if (length <= 0) return []

  let rates: number[][] = []
  for (let startingRate = startMin; startingRate <= startMax; startingRate += 0.01) {
    rates.push([startingRate])
  }

  for (let i = 0; i < length - 1; i++) {
    let newRates: number[][] = []
    for (let rateChange = incrMin; rateChange <= incrMax; rateChange += 0.01) {
      for (let r of rates) {
        const empty: number[] = []
        newRates.push(empty.concat(r, [r[r.length - 1] - rateChange]))
      }
    }
    rates = newRates
  }

  // Convert rates into predictions
  let predictions: Prediction[] = []
  for (let r of rates) {
    predictions.push(r.map(rate => [{ price: rate, probability: 1.0 / rates.length }]))
  }

  return mergePredictions(predictions)
}

function mergePredictions(predictions: Prediction[]): Prediction {
  const ret: Prediction = []

  for (let prediction of predictions) {
    for (let timePeriod = 0; timePeriod < prediction.length; timePeriod++) {
      if (!ret[timePeriod]) ret[timePeriod] = []
      for (let price of prediction[timePeriod]) {
        let retPrice = ret[timePeriod].find(p => p.price === price.price)
        if (!retPrice) {
          retPrice = { price: price.price, probability: 0 }
          ret[timePeriod].push(retPrice)
        }
        retPrice.probability += price.probability
      }
    }
  }

  return ret
}

function multiplyEstimates(a: Estimate[], b: Estimate[]): Estimate[] {
  const ret: Estimate[] = []
  for (const aa of a) {
    for (const bb of b) {
      ret.push({
        price: Math.ceil(aa.price * bb.price),
        probability: aa.probability * bb.probability,
      })
    }
  }
  return ret
}

function TestUpdateSheet(buyPrice: number, sellPrices: number[]) {
  updateSheet(<GoogleAppsScript.Spreadsheet.Range>(<unknown>{
    getRow() {
      return 0
    },
    getSheet() {
      return {
        getRange() {
          return {
            getValue() {
              return buyPrice
            },
            getValues() {
              return [sellPrices.filter((_, idx) => idx % 2 === 0), sellPrices.filter((_, idx) => idx % 2 === 1)]
            },
            getCell() {
              return {
                setValue() {},
                setFontColor() {},
                setFontStyle() {},
              }
            },
          }
        },
      }
    },
  }))
}

function GetPatternProbabilities() {
  const iters = 10000000
  const results = [0, 0, 0, 0]

  for (let i = 0; i < iters; i++) {
    let pattern = Math.floor(4 * Math.random())
    for (let j = 0; j < 1000; j++) {
      pattern = getNextPattern(pattern)
    }
    results[pattern] += 100 / iters
  }

  return results

  function getNextPattern(pattern) {
    const r = Math.random()
    switch (pattern) {
      case 0:
        if (r < 0.2) return 0
        if (r < 0.5) return 1
        if (r < 0.65) return 2
        return 3
      case 1:
        if (r < 0.5) return 0
        if (r < 0.55) return 1
        if (r < 0.75) return 2
        return 3
      case 2:
        if (r < 0.25) return 0
        if (r < 0.7) return 1
        if (r < 0.75) return 2
        return 3
      case 3:
        if (r < 0.45) return 0
        if (r < 0.7) return 1
        if (r < 0.85) return 2
        return 3
    }
    return -1
  }
}
