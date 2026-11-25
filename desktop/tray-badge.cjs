const glyphs = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};
function badgeBitmap(original, count) {
  const buffer = Buffer.from(original);
  if (buffer.length !== 32 * 32 * 4 || count <= 0) return buffer;
  const pixel = (x, y, b, g, r) => {
    if (x < 0 || x > 31 || y < 0 || y > 31) return;
    const i = (y * 32 + x) * 4;
    buffer[i] = b;
    buffer[i + 1] = g;
    buffer[i + 2] = r;
    buffer[i + 3] = 255;
  };
  for (let y = 0; y < 22; y++)
    for (let x = 10; x < 32; x++)
      if ((x - 21) ** 2 + (y - 10) ** 2 <= 110) pixel(x, y, 70, 62, 230);
  const label = count > 99 ? '99+' : String(count),
    scale = label.length === 1 ? 2 : 1;
  const width = (label.length * 4 - 1) * scale,
    start = Math.round(21 - width / 2),
    top = Math.round(10 - (5 * scale) / 2);
  [...label].forEach((char, index) =>
    glyphs[char].forEach((row, y) =>
      [...row].forEach((value, x) => {
        if (value === '1')
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              pixel(start + (index * 4 + x) * scale + dx, top + y * scale + dy, 255, 255, 255);
      }),
    ),
  );
  return buffer;
}
module.exports = { badgeBitmap };
