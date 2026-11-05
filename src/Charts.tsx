import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler } from 'chart.js';
import { wave } from './data';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

export function Sparkline({ seed = 0, color = '#168365', width = 94, height = 30 }: { seed?: number; color?: string; width?: number; height?: number }) {
  const values = wave(seed, 28);
  const points = values.map((v, i) => `${i / 27 * width},${height - ((v - 0.45) / 0.7) * (height - 4)}`).join(' ');
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function ThroughputChart({ period, tick, dark, metric = 'Throughput', base = 2.89 }: { period: string; tick: number; dark: boolean; metric?: string; base?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const scale = metric === 'Latency' ? 42 : metric === 'Packet loss' ? 0.04 : base * 1.17;
    const count = 61;
    const hours = period === '24h' ? 24 : period === '6h' ? 6 : 1;
    const end = new Date(Date.UTC(2026, 10, 4, 14, 32));
    const labels = Array.from({ length: count }, (_, i) => new Date(end.getTime() - (60 - i) * hours * 60000).toISOString().slice(11, 16));
    const values = wave((period === '1h' ? 3 : period === '6h' ? 8 : 14) + tick * 0.015, count, scale);
    const previous = wave(13, count, scale * 0.8);
    const context = canvas.current.getContext('2d');
    const gradient = context?.createLinearGradient(0, 0, 0, 235);
    gradient?.addColorStop(0, dark ? 'rgba(47,178,141,.22)' : 'rgba(22,131,101,.13)');
    gradient?.addColorStop(1, 'rgba(22,131,101,0)');
    const unit = metric === 'Latency' ? ' ms' : metric === 'Packet loss' ? '%' : 'M';
    const chart = new Chart(canvas.current, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Previous period', data: previous, borderColor: dark ? '#54616b' : '#b9c5c9', borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.26 },
        { label: 'Current period', data: values, borderColor: dark ? '#48c59d' : '#168365', backgroundColor: gradient || 'transparent', fill: true, borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#168365', tension: 0.26 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' },
        plugins: { tooltip: { backgroundColor: '#1b2a30', padding: 12, displayColors: true, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(metric === 'Packet loss' ? 3 : 2)}${unit}` } } },
        scales: {
          x: { border: { display: false }, grid: { display: false }, ticks: { color: dark ? '#a1adb5' : '#849099', maxTicksLimit: 7, maxRotation: 0, font: { size: 10, family: 'Helvetica Neue' } } },
          y: { min: 0, suggestedMax: scale * 1.05, border: { display: false }, grid: { color: dark ? '#2b3740' : '#eef1f3' }, ticks: { color: dark ? '#a1adb5' : '#849099', maxTicksLimit: 5, padding: 10, font: { size: 10, family: 'Helvetica Neue' }, callback: value => `${Number(value).toFixed(metric === 'Packet loss' ? 2 : metric === 'Latency' ? 0 : 1)}${unit}` } },
        },
      },
    });
    return () => chart.destroy();
  }, [period, tick, dark, metric, base]);
  return <div className="chart-canvas"><canvas ref={canvas} role="img" aria-label={`Simulated ${metric.toLowerCase()} during the last ${period}, with the previous period for comparison.`}>Simulated {metric} chart for the last {period}.</canvas></div>;
}
