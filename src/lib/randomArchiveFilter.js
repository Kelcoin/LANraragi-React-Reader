export const RANDOM_HIDE_READ_KEY = 'lrr_random_hide_read';

export function getRandomHideRead(storage = globalThis.localStorage) {
  return storage?.getItem(RANDOM_HIDE_READ_KEY) === '1';
}

export function setRandomHideRead(value, storage = globalThis.localStorage) {
  storage?.setItem(RANDOM_HIDE_READ_KEY, value ? '1' : '0');
}

export function filterRandomArchives(archives, histories, hideRead) {
  const list = Array.isArray(archives) ? archives : [];
  if (!hideRead) return list;

  const historyById = new Map((Array.isArray(histories) ? histories : []).map((item) => [
    String(item?.id || item?.arcid || ''),
    item,
  ]));

  return list.filter((archive) => {
    const history = historyById.get(String(archive?.arcid || archive?.id || ''));
    const page = Math.max(
      Number(archive?.progress) || 0,
      Number(archive?.page) || 0,
      Number(history?.page) || 0,
    );
    const total = Math.max(
      Number(archive?.pagecount) || 0,
      Number(archive?.total) || 0,
      Number(history?.pagecount) || 0,
      Number(history?.total) || 0,
    );
    return total <= 0 || page < total;
  });
}
