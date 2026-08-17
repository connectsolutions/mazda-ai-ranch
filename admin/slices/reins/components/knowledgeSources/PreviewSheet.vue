<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet';
import type { ISource } from '#reins/stores/knowledge';
import type { ISourcePreview } from '#reins/stores/knowledge';

const props = defineProps<{
  knowledgeId: string;
  source: ISource | null;
}>();
const emit = defineEmits<{ close: [] }>();

const store = useKnowledgeStore();

const preview = ref<ISourcePreview | null>(null);
const text = ref<string | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

type PreviewKind = 'frame' | 'text' | 'none';

// What the browser can render inside an iframe or we can dump as text. Office
// formats fall through to "none": no plugin renders them client-side, so the
// sheet offers the download instead.
function kindFor(contentType: string): PreviewKind {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf' || type === 'text/html' || type.startsWith('image/')) {
    return 'frame';
  }
  if (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/csv'
  ) {
    return 'text';
  }
  return 'none';
}

const kind = computed<PreviewKind>(() =>
  preview.value ? kindFor(preview.value.contentType) : 'none',
);

const open = computed(() => props.source !== null);

function reset() {
  preview.value?.revoke();
  preview.value = null;
  text.value = null;
  errorMessage.value = null;
}

async function load(source: ISource) {
  reset();
  loading.value = true;
  try {
    const p = await store.previewSource(props.knowledgeId, source.id);
    preview.value = p;
    if (kindFor(p.contentType) === 'text') {
      // Fetch the object URL back as text; the blob is already local.
      text.value = await (await fetch(p.url)).text();
    }
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Could not load this source';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.source,
  (source) => {
    if (source) void load(source);
    else reset();
  },
  { immediate: true },
);

onBeforeUnmount(reset);

function openInNewTab() {
  if (!preview.value) return;
  window.open(preview.value.url, '_blank', 'noopener');
}

async function download() {
  if (!props.source) return;
  await store.downloadSource(props.knowledgeId, props.source.id);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <Sheet :open="open" @update:open="(v: boolean) => !v && emit('close')">
    <SheetContent side="right" class="flex w-full flex-col sm:max-w-3xl">
      <SheetHeader>
        <SheetTitle class="truncate pr-6" :title="source?.name">
          {{ source?.name ?? '' }}
        </SheetTitle>
        <SheetDescription v-if="preview">
          {{ preview.contentType.split(';')[0] }} · {{ formatBytes(preview.size) }}
        </SheetDescription>
      </SheetHeader>

      <div class="min-h-0 flex-1 overflow-hidden px-4">
        <div v-if="loading" class="py-6 text-sm text-muted-foreground">
          Loading…
        </div>
        <p v-else-if="errorMessage" class="py-6 text-sm text-destructive">
          {{ errorMessage }}
        </p>
        <iframe
          v-else-if="preview && kind === 'frame'"
          :src="preview.url"
          :title="source?.name"
          class="h-full w-full rounded-md border bg-white"
        />
        <pre
          v-else-if="preview && kind === 'text'"
          class="h-full overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words"
        >{{ text ?? '' }}</pre>
        <div
          v-else-if="preview"
          class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          No inline preview for this file type. Download it to open locally.
        </div>
      </div>

      <SheetFooter class="gap-2">
        <Button variant="outline" :disabled="!preview" @click="openInNewTab">
          Open in new tab
        </Button>
        <Button :disabled="!source" @click="download">Download</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
