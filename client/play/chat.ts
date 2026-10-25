// Message feed shared by the room and the end screen: every message from both players stays ~6 s, several are visible at once.
export const CHAT_TTL_MS = 6000;
export const CHAT_MAX = 4;

export function createChat(root: HTMLElement) {
  function push(seat: 0 | 1, nick: string, text: string, mine: boolean) {
    const row = document.createElement('div');
    row.className = `msg s${seat}${mine ? ' me' : ''}`;
    const who = document.createElement('b'); who.textContent = mine ? 'Ты' : nick;
    const body = document.createElement('span'); body.textContent = text;
    row.append(who, body);
    root.appendChild(row);
    while (root.children.length > CHAT_MAX) root.firstElementChild?.remove();
    window.setTimeout(() => { row.classList.add('out'); window.setTimeout(() => row.remove(), 400); }, CHAT_TTL_MS);
  }
  const clear = () => { root.textContent = ''; };
  return { push, clear };
}
