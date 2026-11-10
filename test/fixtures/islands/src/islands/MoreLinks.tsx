/** @jsxImportSource solid-js */
import { createSignal, For, onMount, Show } from 'solid-js';

interface Props {
  links: { href: string; title: string }[];
  /** The button label, from t(locale, …). */
  more: string;
  limit?: number;
}

/** Without JS every link shows. After hydration the list starts short and a button shows the rest. */
export default function MoreLinks(props: Props) {
  const [ready, setReady] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  onMount(() => setReady(true));
  const limit = () => props.limit ?? 3;
  const shown = () => (ready() && !open() ? props.links.slice(0, limit()) : props.links);
  return (
    <>
      <ul>
        <For each={shown()}>
          {(link) => (
            <li>
              <a href={link.href}>{link.title}</a>
            </li>
          )}
        </For>
      </ul>
      <Show when={ready() && !open() && props.links.length > limit()}>
        <button type="button" onClick={() => setOpen(true)}>
          {props.more}
        </button>
      </Show>
    </>
  );
}
