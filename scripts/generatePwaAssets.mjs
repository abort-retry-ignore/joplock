import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const splashDir = path.join(publicDir, 'apple-splash');

const splashScreens = [
	{ width: 1320, height: 2868 },
	{ width: 2868, height: 1320 },
	{ width: 1290, height: 2796 },
	{ width: 2796, height: 1290 },
	{ width: 1179, height: 2556 },
	{ width: 2556, height: 1179 },
	{ width: 1170, height: 2532 },
	{ width: 2532, height: 1170 },
	{ width: 1125, height: 2436 },
	{ width: 2436, height: 1125 },
	{ width: 1242, height: 2688 },
	{ width: 2688, height: 1242 },
	{ width: 828, height: 1792 },
	{ width: 1792, height: 828 },
	{ width: 1536, height: 2048 },
	{ width: 2048, height: 1536 },
	{ width: 1668, height: 2388 },
	{ width: 2388, height: 1668 },
	{ width: 1640, height: 2360 },
	{ width: 2360, height: 1640 },
	{ width: 2048, height: 2732 },
	{ width: 2732, height: 2048 },
];

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(splashDir, { recursive: true });

const iconSvg = (size, maskable = false) => {
	const inset = Math.round(size * (maskable ? 0.035 : 0.08));
	const innerSize = size - inset * 2;
	const innerRadius = Math.round(size * (maskable ? 0.24 : 0.19));
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
		<defs>
			<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="#08110b"/>
				<stop offset="100%" stop-color="#06140f"/>
			</linearGradient>
			<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="#0f1811"/>
				<stop offset="100%" stop-color="#0b1614"/>
			</linearGradient>
			<linearGradient id="accentB" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#32ff70"/>
				<stop offset="100%" stop-color="#15d95b"/>
			</linearGradient>
			<linearGradient id="accentC" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="#2af6d8"/>
				<stop offset="100%" stop-color="#2a8cff"/>
			</linearGradient>
		</defs>
		<rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="url(#bg)"/>
		<rect x="${inset}" y="${inset}" width="${innerSize}" height="${innerSize}" rx="${innerRadius}" fill="url(#panel)" stroke="#68ff99" stroke-opacity="0.25" stroke-width="${Math.max(2, Math.round(size * 0.008))}"/>
		<path d="M${Math.round(size * 0.336)} ${Math.round(size * 0.258)}H${Math.round(size * 0.445)}V${Math.round(size * 0.625)}C${Math.round(size * 0.445)} ${Math.round(size * 0.72)} ${Math.round(size * 0.368)} ${Math.round(size * 0.797)} ${Math.round(size * 0.273)} ${Math.round(size * 0.797)}H${Math.round(size * 0.242)}V${Math.round(size * 0.688)}H${Math.round(size * 0.273)}C${Math.round(size * 0.307)} ${Math.round(size * 0.688)} ${Math.round(size * 0.336)} ${Math.round(size * 0.66)} ${Math.round(size * 0.336)} ${Math.round(size * 0.625)}V${Math.round(size * 0.258)}Z" fill="url(#accentB)"/>
		<path d="M${Math.round(size * 0.492)} ${Math.round(size * 0.258)}H${Math.round(size * 0.758)}V${Math.round(size * 0.367)}H${Math.round(size * 0.602)}V${Math.round(size * 0.797)}H${Math.round(size * 0.492)}V${Math.round(size * 0.258)}Z" fill="url(#accentC)"/>
	</svg>`;
};

const splashSvg = (width, height) => {
	const portrait = height >= width;
	const iconBox = Math.round(Math.min(width, height) * (portrait ? 0.28 : 0.22));
	const iconX = Math.round((width - iconBox) / 2);
	const iconY = Math.round(height * (portrait ? 0.22 : 0.18));
	const titleSize = Math.round(Math.min(width, height) * (portrait ? 0.075 : 0.06));
	const subtitleSize = Math.round(titleSize * 0.3);
	const titleY = iconY + iconBox + Math.round(titleSize * 1.35);
	const subtitleY = titleY + Math.round(subtitleSize * 1.9);
	const logo = iconSvg(iconBox, false).replace('<svg ', `<svg x="${iconX}" y="${iconY}" `);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
		<defs>
			<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#08110b"/>
				<stop offset="100%" stop-color="#030806"/>
			</linearGradient>
			<radialGradient id="glowTop" cx="50%" cy="18%" r="45%">
				<stop offset="0%" stop-color="rgba(50,255,112,0.22)"/>
				<stop offset="100%" stop-color="rgba(50,255,112,0)"/>
			</radialGradient>
			<radialGradient id="glowBottom" cx="50%" cy="84%" r="44%">
				<stop offset="0%" stop-color="rgba(42,246,216,0.14)"/>
				<stop offset="100%" stop-color="rgba(42,246,216,0)"/>
			</radialGradient>
		</defs>
		<rect width="${width}" height="${height}" fill="url(#bg)"/>
		<rect width="${width}" height="${height}" fill="url(#glowTop)"/>
		<rect width="${width}" height="${height}" fill="url(#glowBottom)"/>
		${logo}
		<text x="50%" y="${titleY}" text-anchor="middle" fill="#ecfff2" font-size="${titleSize}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-weight="700">Joplock</text>
		<text x="50%" y="${subtitleY}" text-anchor="middle" fill="rgba(196,255,214,0.84)" font-size="${subtitleSize}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" letter-spacing="${Math.max(1, Math.round(subtitleSize * 0.22))}">THIN CLIENT FOR JOPLIN</text>
	</svg>`;
};

const writePng = async (filePath, svg, size = null) => {
	let image = sharp(Buffer.from(svg));
	if (size) image = image.resize(size, size);
	await image.png().toFile(filePath);
};

await writePng(path.join(publicDir, 'icon-192.png'), iconSvg(192), 192);
await writePng(path.join(publicDir, 'icon-512.png'), iconSvg(512), 512);
await writePng(path.join(publicDir, 'maskable-icon-192.png'), iconSvg(192, true), 192);
await writePng(path.join(publicDir, 'maskable-icon-512.png'), iconSvg(512, true), 512);
await writePng(path.join(publicDir, 'apple-touch-icon.png'), iconSvg(180), 180);

for (const screen of splashScreens) {
	await sharp(Buffer.from(splashSvg(screen.width, screen.height))).png().toFile(path.join(splashDir, `${screen.width}x${screen.height}.png`));
}
