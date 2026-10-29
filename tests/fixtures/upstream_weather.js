// Test oracle: calculateForecastTarget copied verbatim from
// icykoneko/ff14-fish-tracker-app js/app/weather.js (MIT, (c) 2019 icykoneko),
// used only to cross-check app/engine.js.
export function calculateForecastTarget(m) {
  // Based on Rougeadyn's SaintCoinach library.
  var unixTime = parseInt(+m / 1000);
  // Get the Eorzea hour for weather start.
  var bell = unixTime / 175;
  // Magic needed for calculations:
  // 16:00 = 0, 00:00 = 8, 08:00 = 16 . . .
  var inc = (bell + 8 - (bell % 8)) % 24;
  // Take the Eorzea days since Unix Epoch.
  var totalDays = ((unixTime / 4200) << 32) >>> 0; // uint

  // Make the calculations.
  var calcBase = (totalDays * 100) + inc;
  var step1 = ((calcBase << 11) ^ calcBase) >>> 0;
  var step2 = ((step1 >>> 8) ^ step1) >>> 0;

  return step2 % 100;
}
