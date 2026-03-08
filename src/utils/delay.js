/**
 * Random delay between min and max seconds (default 90-180s).
 */
export function randomDelay(minSeconds = 90, maxSeconds = 180) {
  const ms = (Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds) * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
