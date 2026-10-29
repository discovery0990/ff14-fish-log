// Test oracle: calculateForecastTarget copied verbatim from
// icykoneko/ff14-fish-tracker-app js/app/weather.js (MIT, (c) 2019 icykoneko),
// used only to cross-check app/engine.js.
//
// MIT License
//
// Copyright (c) 2019 icykoneko
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
