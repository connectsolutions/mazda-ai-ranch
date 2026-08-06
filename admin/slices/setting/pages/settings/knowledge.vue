<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const SETTING_GROUP = 'knowledge';

interface ITextField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  description?: string;
}

const TEXT_FIELDS: ITextField[] = [
  {
    name: 'url',
    label: 'Knowledge service URL',
    placeholder: 'http://lightrag.platform.svc.cluster.local:9621',
  },
  {
    name: 'api_key',
    label: 'API key',
    type: 'password',
    placeholder: 'shared secret with the knowledge service',
  },
  {
    name: 's3_bucket',
    label: 'S3 bucket for source files',
    placeholder: 'ranch-reins-sources',
  },
];

const settingStore = useSettingStore();
const llmStore = useLlmStore();
const knowledgeStore = useKnowledgeStore();

await Promise.all([
  useAsyncData('admin-settings-knowledge', () => settingStore.fetchAll()),
  useAsyncData('admin-settings-knowledge-llms', () => llmStore.fetchAll()),
  useAsyncData('admin-settings-knowledge-runtime', () =>
    knowledgeStore.fetchStatus(),
  ),
]);

function readEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

function readString(name: string): string {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'string' ? v : '';
}

const enabled = ref<boolean>(readEnabled());
const values = reactive<Record<string, string>>({});
for (const f of TEXT_FIELDS) {
  values[f.name] = readString(f.name);
}
const chatCredentialId = ref<string>(readString('chat_credential_id'));

const chatCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter((c) => c.supportsChat && c.status === 'active'),
);

const runtime = computed(() => knowledgeStore.runtime);

const runtimeRows = computed<{ label: string; value: string | null }[]>(() => {
  const r = knowledgeStore.runtime;
  if (r === null) return [];
  return [
    { label: 'Chat binding', value: r.llmBinding },
    { label: 'Chat model', value: r.llmModel },
    { label: 'Embedding binding', value: r.embeddingBinding },
    { label: 'Embedding model', value: r.embeddingModel },
    { label: 'Embedding endpoint', value: r.embeddingBindingHost },
  ];
});

function credentialLabel(c: ILlmCredentialData): string {
  const tag = c.label !== null && c.label.length > 0 ? ` (${c.label})` : '';
  return `${c.provider} / ${c.model}${tag}`;
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave(): Promise<void> {
  if (enabled.value && chatCredentialId.value === '') {
    errorMessage.value = 'Pick a chat credential before enabling the service.';
    return;
  }

  saving.value = true;
  errorMessage.value = null;
  try {
    const tasks: Promise<unknown>[] = [];

    const currentEnabled = settingStore.get(SETTING_GROUP, 'enabled')?.value;
    const currentEnabledBool =
      typeof currentEnabled === 'boolean' ? currentEnabled : true;
    if (enabled.value !== currentEnabledBool) {
      tasks.push(
        settingStore.upsert(SETTING_GROUP, 'enabled', enabled.value, 'json'),
      );
    }

    for (const f of TEXT_FIELDS) {
      const next = values[f.name] ?? '';
      const current = settingStore.get(SETTING_GROUP, f.name)?.value;
      if (next !== (typeof current === 'string' ? current : '')) {
        tasks.push(settingStore.upsert(SETTING_GROUP, f.name, next, 'string'));
      }
    }

    const currentChat = readString('chat_credential_id');
    if (chatCredentialId.value !== currentChat) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'chat_credential_id',
          chatCredentialId.value,
          'string',
        ),
      );
    }

    await Promise.all(tasks);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>Knowledge service</CardTitle>
        <CardDescription>
          External RAG/knowledge service. Toggle off to disable knowledges
          across the admin and runtime even if the URL is set.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="knowledge-enabled">
          <Checkbox
            id="knowledge-enabled"
            :model-value="enabled"
            @update:model-value="(v: boolean | 'indeterminate') => (enabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="knowledge-enabled" class="cursor-pointer">
              Enable knowledge service
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, /knowledges API returns disabled and the admin hides
              knowledge pickers.
            </p>
            <p class="text-xs text-muted-foreground/70">knowledge/enabled</p>
          </div>
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>LLM credentials</CardTitle>
        <CardDescription>
          The chat credential LightRAG should use for entity extraction and
          answers. Note that LightRAG has no Anthropic binding: Claude reaches
          it only through Bedrock or an OpenAI-compatible gateway.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="chat-credential">Chat LLM credential</Label>
          <select
            id="chat-credential"
            v-model="chatCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option
              v-for="c in chatCredentials"
              :key="c.id"
              :value="c.id"
            >
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            Used as <code>LLM_BINDING</code> / <code>LLM_MODEL</code> /
            <code>LLM_BINDING_API_KEY</code> in the LightRAG container.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/chat_credential_id
          </p>
        </div>

        <p
          class="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
        >
          This is intent, not effect. LightRAG resolves its bindings from
          container env at startup, so after changing anything here update the
          matching vars in your <code>.env</code> (local dev) or the
          <code>lightrag-api</code> k8s secret (prod) and restart the LightRAG
          pod. What it is running right now is shown below.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>What LightRAG is running</CardTitle>
        <CardDescription>
          Read live from the service. The embedding model is not selectable
          here: it is fixed by the container env, and changing it invalidates
          every stored vector, so it needs a full re-index.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="runtime === null" class="text-sm text-muted-foreground">
          Not reachable. Check the service URL and API key above, then reload.
        </p>
        <dl v-else class="grid max-w-xl gap-2 text-sm">
          <div v-for="row in runtimeRows" :key="row.label" class="flex gap-3">
            <dt class="w-56 shrink-0 text-muted-foreground">
              {{ row.label }}
            </dt>
            <dd class="font-mono">{{ row.value ?? 'unset' }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Service connection</CardTitle>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div v-for="field in TEXT_FIELDS" :key="field.name" class="grid gap-2">
          <Label :for="`knowledge-${field.name}`">{{ field.label }}</Label>
          <Input
            :id="`knowledge-${field.name}`"
            v-model="values[field.name]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'new-password' : 'off'"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
          />
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ SETTING_GROUP }}/{{ field.name }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">
        Saved at {{ savedAt }}
      </span>
      <span v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </span>
    </div>
  </div>
</template>
