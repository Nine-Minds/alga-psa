export function parseArgs(argv) {
  const args = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.push(token);
      continue;
    }

    const keyValue = token.slice(2).split('=');
    const key = keyValue[0];
    if (!key) {
      continue;
    }

    if (keyValue.length > 1) {
      flags[key] = keyValue.slice(1).join('=');
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return { args, flags };
}

export function toBoolean(value, fallback = false) {
  if (value === true) {
    return true;
  }
  if (value === false || value == null) {
    return fallback;
  }
  const text = String(value).toLowerCase().trim();
  return text === '1' || text === 'true' || text === 'yes' || text === 'y';
}
