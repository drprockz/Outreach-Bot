import 'dotenv/config';
import { getCostSummary, getCostChart } from '../../db/database.js';

console.log('Cost Summary:');
const summary = getCostSummary();
console.log(`  Today:  $${summary.today.toFixed(4)}`);
console.log(`  Week:   $${summary.week.toFixed(4)}`);
console.log(`  Month:  $${summary.month.toFixed(4)}`);
console.log('\nBreakdown by job:');
for (const row of summary.breakdown) {
  console.log(`  ${row.job}: ${row.calls} calls, $${row.total.toFixed(4)}, ${row.input_t} in / ${row.output_t} out tokens`);
}

console.log('\nDaily chart (last 30 days):');
const chart = getCostChart();
for (const day of chart) {
  console.log(`  ${day.day}: $${day.cost.toFixed(4)}`);
}
if (chart.length === 0) console.log('  (no data yet)');
