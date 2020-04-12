/**
 * A Google App Script to manage Animal Crossing New Horizon's Stalk Market predictions
 *
 * @version 2.2.0
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
  if (sheetName.includes('[calc]') && edit.range.getRow() > 1 && edit.range.getColumn() > 1 && edit.range.getColumn() < 16) {
    const col = edit.range.getColumn()
    if (col >= 4 && col <= 14 && col % 2 === 0) {
      toggleChart(edit.range, edit.value)
    } else {
      updateSheet(edit.range)
    }
  }
}
// The simple trigger of onEdit didn't seem to be working, so I manually made another trigger to wrap it for my sheet
// If you're having issues, this might be the fix
function _onEdit(edit: GoogleAppsScript.Events.SheetsOnEdit) {
  onEdit(edit)
}

// Chooses which data range to power the chart based on what box is checked
function toggleChart(range: GoogleAppsScript.Spreadsheet.Range, value: string) {
  const sheet = range.getSheet()
  const charts = sheet.getCharts()
  // If the box was unchecked, remove the chart and exit
  if (value.toLowerCase() !== 'true') {
    for (let chart of charts) {
      sheet.removeChart(chart)
    }
    return
  }
  // Otherwise uncheck any other checkboxes
  const selfRow = range.getRow() - 2
  const selfCol = range.getColumn() - 4
  const checkboxSearchRange = sheet.getRange(2, 4, 1000, 12)
  const checkboxSearchValues = checkboxSearchRange.getValues()
  for (let row = 0; row < checkboxSearchValues.length; row++) {
    for (let col = 0; col < checkboxSearchValues[row].length; col += 2) {
      if ((row !== selfRow || col !== selfCol) && checkboxSearchValues[row][col] === true) {
        checkboxSearchRange.getCell(row + 1, col + 1).setValue(false)
      }
    }
  }

  // Create a chart if needed
  let chart = charts.length ? charts[0] : sheet.newChart().setPosition(2, 17, 0, 0).setOption('width', 800).setOption('height', 600).build()

  // Find the data
  const dataCol = getDataColumn(range.getRow(), range.getColumn())
  const title = sheet.getRange(1, dataCol).getValue()
  const labelsRange = sheet.getRange(2, 29, 661)
  const dataRange = sheet.getRange(2, dataCol, 661)
  const integralRange = sheet.getRange(663, dataCol, 661)

  // Update the chart
  chart = chart
    .modify()
    .asComboChart()
    .setTitle(title)
    .setXAxisTitle('Turnip Price in Bells')
    .setColors(['#b6d7a8', '#a4c2f4'])
    .clearRanges()
    .addRange(labelsRange)
    .addRange(dataRange)
    .addRange(integralRange)
    .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
    .setOption('useFirstColumnAsDomain', true)
    .setOption('focusTarget', 'category')
    .setOption('titleTextStyle', { alignment: 'center' })
    .setOption('legend.position', 'none')
    .setOption('series', {
      0: {
        type: 'area',
        lineWidth: 1,
      },
      1: {
        type: 'line',
        targetAxisIndex: 1,
      },
    })
    .setOption('vAxes', {
      0: {
        title: 'Individual Probability Percentage',
      },
      1: {
        title: 'Cumulative Probability Percentage',
        maxValue: 1,
      },
    })
    .build()

  // Update the sheet with the new chart
  charts.length ? sheet.updateChart(chart) : sheet.insertChart(chart)
}

// Does the data extraction and formatting of results
function updateSheet(range: GoogleAppsScript.Spreadsheet.Range) {
  // This part extracts data from the sheet, assuming a very specific format
  // If you change the format of the sheet please update this part!
  // You'll also need to update the part below if you change the structure
  // of how AM/PM prices are entered
  const sheet = range.getSheet()
  const editRow = range.getRow() - (range.getRow() % 2) // Round down to nearest multiple of 2

  // Get manually entered buy/sell prices
  const sellRange = sheet.getRange(editRow, 4, 2, 13)
  let buyPrice: number | null = Number(sheet.getRange(editRow, 2).getValue())
  buyPrice = buyPrice < 90 || buyPrice > 110 ? null : buyPrice // Sanitize buyPrice
  const sellPrices = [buyPrice || 90, buyPrice || 110]
  const sellValues = sellRange.getValues()
  for (let col = 1; col < 12; col += 2) {
    for (let row = 0; row < 2; row++) {
      sellPrices.push(Number(sellValues[row][col] || 'NaN') || NaN)
    }
  }

  // Generate prediction off of sellPrices
  let prediction = mergePredictions([generatePatternZero(sellPrices), generatePatternOne(sellPrices), generatePatternTwo(sellPrices), generatePatternThree(sellPrices)])

  // Normalize prediction probabilities
  for (let estimates of prediction.estimates) {
    let mul = 1.0 / estimates.map(p => p.probability).reduce((a, b) => a + b, 0)
    for (let e of estimates) {
      e.probability *= mul
    }
  }
  let mul = 1.0 / prediction.trends.map(p => p.probability).reduce((a, b) => a + b, 0)
  for (let t of prediction.trends) {
    t.probability *= mul
  }

  // For each cell set the value based on prediction
  // We store this in an array and set it all at once for performance
  const islandName = sheet.getRange(editRow, 1).getValue()
  const days = sheet
    .getRange(1, 4, 1, 12)
    .getValues()[0]
    .filter(v => v)
  const times = sheet
    .getRange(editRow, 3, 2, 1)
    .getValues()
    .map(v => v[0])
  const displayValues: GoogleAppsScript.Spreadsheet.RichTextValue[][] = [Array(12).fill(null), Array(12).fill(null)]
  const dataValues: string[][] = [] // array of columns, we convert to rows later
  const normalStyle = SpreadsheetApp.newTextStyle().setItalic(false).setForegroundColor('#000').build()
  const predictionStyle = SpreadsheetApp.newTextStyle().setItalic(true).setForegroundColor('#999').build()

  // Copy the checkbox values
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 12; col += 2) {
      displayValues[row][col] = SpreadsheetApp.newRichTextValue().setText(sellValues[row][col]).build()
    }
  }

  // Set the display values for each cell, and construct the data column
  sellPrices.slice(2).forEach((v, idx) => {
    const estimates = prediction.estimates[idx + 2]

    const day = days[Math.floor(idx / 2)]
    const time = times[idx % 2]
    const chartTitle = `${islandName} ${day} ${time}`

    const richText = SpreadsheetApp.newRichTextValue()

    if (!isNaN(v)) {
      richText.setText(`${v}`).setTextStyle(normalStyle)
      dataValues.push(fillEstimates(chartTitle, [{ price: v, probability: 1 }]))
    } else if (!estimates) {
      richText.setText('ERROR').setTextStyle(predictionStyle)
      dataValues.push(fillEstimates(chartTitle, []))
    } else {
      const min = Math.min(...estimates.map(e => e.price))
      const max = Math.max(...estimates.map(e => e.price))
      // This one is a bit weird and I am likely getting the math wrong
      const probable = estimates.reduce((a, b) => a + b.price * b.probability, 0).toFixed(0)

      const value = isFinite(min) && isFinite(max) ? `${min}-${probable}-${max}` : ''
      richText.setText(value).setTextStyle(predictionStyle)
      dataValues.push(fillEstimates(chartTitle, estimates))
    }

    displayValues[idx % 2][1 + 2 * Math.floor(idx / 2)] = richText.build()
  })

  // Add the trends to the display values
  const trendText = SpreadsheetApp.newRichTextValue()
  trendText.setText(
    prediction.trends
      .sort((a, b) => b.probability - a.probability)
      .map(t => `${t.name}: ${(100 * t.probability).toFixed(2)}%`)
      .join('\n'),
  )
  displayValues[0].push(trendText.build())
  displayValues[1].push(trendText.build())

  // Fill the display data
  sellRange.setRichTextValues(displayValues)
  // Set the titles for the chart data, in case it's not already there
  sheet
    .getRange(2, 29, 661)
    .setValues(
      Array(661)
        .fill(undefined)
        .map((_, i) => [i]),
    )
    .setNumberFormat('#,###')
  // Fill the chart data
  sheet
    .getRange(1, getDataColumn(editRow, 0), 1323, 12)
    .setValues(
      Array(1323)
        .fill(undefined)
        .map((_, i) => dataValues.map(v => v[i])),
    )
    .setNumberFormat('#,##0.00%')
}

// row & col are absolute. col is clamped to valid values.
function getDataColumn(row: number, col: number) {
  let ret = 30 + 12 * (Math.floor(row / 2) - 1) // Find the start of this island's data
  ret += Math.min(Math.max(2 * Math.floor((col - 4) / 2), 0), 11)
  ret += row % 2 // Add 1 for afternoon
  return ret
}

function fillEstimates(title: string, estimates: Estimate[]): string[] {
  let values: string[] = Array(661).fill(0)
  for (const e of estimates) {
    values[e.price] = `${e.probability}`
  }
  let value = 0
  values = values.concat(
    values
      .reduceRight((arr, v) => {
        value += Number(v)
        arr.push(`${value}`)
        return arr
      }, Array<string>())
      .reverse(),
  )
  values.unshift(title)
  return values
}

interface Prediction {
  estimates: Estimate[][] // outer array is time periods, inner array is prices for that time period
  trends: Trend[]
}
interface Estimate {
  price: number // Always an integer, except for where we abuse this type to also handle rates
  probability: number // All probabilities in the same time period should add up to 1
}
interface Trend {
  name: string
  probability: number
}

function generatePatternZero(given_prices: number[]): Prediction {
  let predictions: (Prediction | undefined)[] = []
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

        predictions.push(
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
        )
      }
    }
  }

  return mergePredictions(predictions)
}

function generatePatternOne(given_prices: number[]): Prediction {
  let predictions: (Prediction | undefined)[] = []
  const probability1 = 0.248

  for (let peak_start = 3; peak_start < 10; peak_start++) {
    const probability2 = probability1 / 7
    const rates = generateRates(0.85, 0.9, 0.03, 0.05, peak_start - 2)

    predictions.push(generatePatternOneWithPeak(given_prices, peak_start, rates, probability2))
  }

  return mergePredictions(predictions)
}

function generatePatternTwo(given_prices: number[]): Prediction | undefined {
  const probability1 = 0.1475

  const rates = generateRates(0.85, 0.9, 0.03, 0.05, 12)
  const prediction = generatePatternTwoWithRates(given_prices, rates, probability1)

  return prediction
}

function generatePatternThree(given_prices: number[]): Prediction {
  let predictions: (Prediction | undefined)[] = []
  const probability1 = 0.2585

  for (let peak_start = 2; peak_start < 10; peak_start++) {
    const probability2 = probability1 / 8
    const dec_rates_1 = generateRates(0.4, 0.9, 0.03, 0.05, peak_start - 2)
    const dec_rates_2 = generateRates(0.4, 0.9, 0.03, 0.05, 9 - peak_start)

    for (let spikeRate = 1.4; spikeRate <= 2.001; spikeRate += 0.01) {
      const probability3 = probability2 / 61

      predictions.push(generatePatternThreeWithPeak(given_prices, peak_start, spikeRate, dec_rates_1, dec_rates_2, probability3))
    }
  }

  return mergePredictions(predictions)
}

function generatePatternZeroWithLengths(
  given_prices: number[],
  high_phase_1_len: number,
  dec_phase_1_len: number,
  high_phase_2_len: number,
  dec_phase_2_len: number,
  high_phase_3_len: number,
  dec_phase_1_rates: Estimate[][],
  dec_phase_2_rates: Estimate[][],
  probability: number,
): Prediction | undefined {
  let predicted_prices: Estimate[][] = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  // High Phase 1
  for (let i = 2; i < 2 + high_phase_1_len; i++) {
    let min_pred = Math.floor(0.9 * given_prices[0])
    let max_pred = Math.ceil(1.4 * given_prices[1])

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return
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
        return
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
        return
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
        return
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
        return
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }
  return {
    estimates: predicted_prices,
    trends: [{ name: 'Random', probability }],
  }
}

function generatePatternOneWithPeak(given_prices: number[], peak_start: number, rates: Estimate[][], probability: number): Prediction | undefined {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < peak_start; i++) {
    let estimates = multiplyEstimates(rates[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return
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
        return
      }
      min_pred = given_prices[i]
      max_pred = given_prices[i]
    }

    predicted_prices.push(priceRange(min_pred, max_pred, probability))
  }
  return {
    estimates: predicted_prices,
    trends: [{ name: 'Big Spike', probability }],
  }
}

function generatePatternTwoWithRates(given_prices: number[], rates: Estimate[][], probability: number): Prediction | undefined {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < 14; i++) {
    let estimates = multiplyEstimates(rates[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  return {
    estimates: predicted_prices,
    trends: [{ name: 'Decreasing', probability }],
  }
}

function generatePatternThreeWithPeak(
  given_prices: number[],
  peak_start: number,
  spike_rate: number,
  dec_rates_1: Estimate[][],
  dec_rates_2: Estimate[][],
  probability: number,
): Prediction | undefined {
  let predicted_prices = [priceRange(given_prices[0], given_prices[1], probability), priceRange(given_prices[0], given_prices[1], probability)]

  for (let i = 2; i < peak_start; i++) {
    let estimates = multiplyEstimates(dec_rates_1[i - 2], priceRange(given_prices[0], given_prices[1], probability))
    const min_pred = Math.min(...estimates.map(e => e.price))
    const max_pred = Math.max(...estimates.map(e => e.price))

    if (!isNaN(given_prices[i])) {
      if (given_prices[i] < min_pred || given_prices[i] > max_pred) {
        // Given price is out of predicted range, so this is the wrong pattern
        return
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
        return
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
        return
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
        return
      }
      estimates = priceRange(given_prices[i], given_prices[i], probability)
    }

    predicted_prices.push(estimates)
  }

  return {
    estimates: predicted_prices,
    trends: [{ name: 'Small Spike', probability }],
  }
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

function generateRates(startMin: number, startMax: number, incrMin: number, incrMax: number, length: number): Estimate[][] {
  if (length <= 0) return []

  const rateInterval = 0.01
  const initialProbability = 1.0 / (Math.round((startMax - startMin) / rateInterval) + 1)
  const changeProbability = 1.0 / (Math.round((incrMax - incrMin) / rateInterval) + 1)

  let rates: Estimate[][] = Array(length)
    .fill(undefined)
    .map(() => [])
  for (let startingRate = startMin; startingRate <= startMax + rateInterval / 10; startingRate += rateInterval) {
    rates[0].push({ price: startingRate, probability: initialProbability })
  }

  for (let i = 0; i < length - 1; i++) {
    let period = new Map<number, Estimate>()
    for (let priorRate of rates[i]) {
      for (let rateChange = incrMin; rateChange <= incrMax + rateInterval / 10; rateChange += rateInterval) {
        const price = priorRate.price - rateChange
        let e = period.get(price)
        if (!e) {
          e = { price, probability: 0 }
          period.set(price, e)
        }
        e.probability += priorRate.probability * changeProbability
      }
    }
    rates[i + 1] = Array.from(period.values())
  }

  return rates
}

function mergePredictions(predictions: (Prediction | undefined)[]): Prediction {
  const estimates = []
  const trends = new Map<string, Trend>()

  for (let prediction of predictions) {
    if (!prediction) continue

    for (let timePeriod = 0; timePeriod < prediction.estimates.length; timePeriod++) {
      if (!estimates[timePeriod]) estimates[timePeriod] = new Map<number, Estimate>()
      for (let price of prediction.estimates[timePeriod]) {
        let retPrice = estimates[timePeriod].get(price.price)
        if (!retPrice) {
          retPrice = { price: price.price, probability: 0 }
          estimates[timePeriod].set(price.price, retPrice)
        }
        retPrice.probability += price.probability
      }
    }

    for (let trend of prediction.trends) {
      let t = trends.get(trend.name)
      if (!t) {
        t = { name: trend.name, probability: 0 }
        trends.set(trend.name, t)
      }
      t.probability += trend.probability
    }
  }

  return {
    estimates: estimates.map(m => Array.from(m.values())),
    trends: Array.from(trends.values()),
  }
}

function multiplyEstimates(a: Estimate[], b: Estimate[]): Estimate[] {
  const ret = new Map<number, Estimate>()
  for (const aa of a) {
    for (const bb of b) {
      const price = Math.ceil(aa.price * bb.price)
      let e = ret.get(price)
      if (!e) {
        e = { price, probability: 0 }
        ret.set(price, e)
      }
      e.probability += aa.probability * bb.probability
    }
  }
  return Array.from(ret.values())
}

declare var self: any
declare var global: any
function TestUpdateSheet(buyPrice: number, sellPrices: number[]) {
  const g = (typeof self === 'object' && self.self === self && self) || (typeof global === 'object' && global.global === global && global) || this
  g.SpreadsheetApp = g.SpreadsheetApp || {
    newTextStyle() {
      return {
        setItalic() {
          return this
        },
        setForegroundColor() {
          return this
        },
        build() {
          return this
        },
      }
    },
    newRichTextValue() {
      return {
        setText(v: string) {
          console.log(v)
          return this
        },
        setTextStyle() {
          return this
        },
        build() {
          return this
        },
      }
    },
  }
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
              return [
                Array(12)
                  .fill(false)
                  .map((v, i) => (i % 2 === 1 ? sellPrices[i - 1] : v)),
                Array(12)
                  .fill(false)
                  .map((v, i) => (i % 2 === 1 ? sellPrices[i] : v)),
              ]
            },
            getCell() {
              return {
                setValue() {},
                setFontColor() {},
                setFontStyle() {},
              }
            },
            setValues() {
              return this
            },
            setRichTextValues() {
              return this
            },
            setNumberFormat() {
              return this
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

  function getNextPattern(pattern: number) {
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
