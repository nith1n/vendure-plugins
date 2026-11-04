import {
    Alert,
    AlertDescription,
    AlertTitle,
    api,
    Button,
    Label,
    MultiSelect,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from '@vendure/dashboard';
import type { ResultOf } from '@/gql';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    akeneoSettingsQuery,
    akeneoSuggestedLocaleMappingQuery,
    akeneoSyncOptionsQuery,
    saveAkeneoSyncSettingsMutation,
} from './akeneo-settings.graphql';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type LanguageCode = Settings['localeMapping'][number]['languageCode'];

/** Base UI selects need a non-empty value for the "not mapped" option. */
const NOT_MAPPED = '__not_mapped__';

interface SyncValues {
    channelCode: string;
    /** Vendure language -> Akeneo locale; missing means not mapped. */
    mapping: Partial<Record<LanguageCode, string>>;
    trees: string[];
    includeRoot: boolean;
    enabled: boolean;
}

function toValues(settings: Settings): SyncValues {
    return {
        channelCode: settings.channelCode ?? '',
        mapping: Object.fromEntries(settings.localeMapping.map(m => [m.languageCode, m.locale])),
        trees: settings.categoryTreeCodes,
        includeRoot: settings.includeCategoryRoot,
        enabled: settings.enabled,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

interface BlockProps {
    settings: Settings | null | undefined;
    queryKey: string[];
    /** Reports unsaved changes, so other blocks can wait for them to be saved. */
    onDirtyChange: (dirty: boolean) => void;
}

export function AkeneoSyncSettingsBlock({ settings, ...props }: Readonly<BlockProps>) {
    if (!settings) {
        return <p className="text-sm text-muted-foreground">Save the connection first.</p>;
    }
    // Remount when the instance changes, so options and values start fresh
    return <SyncSettingsForm key={settings.baseUrl} settings={settings} {...props} />;
}

function SyncSettingsForm({
    settings,
    queryKey,
    onDirtyChange,
}: Readonly<Omit<BlockProps, 'settings'> & { settings: Settings }>) {
    const queryClient = useQueryClient();
    const [values, setValues] = useState(() => toValues(settings));
    const saved = useMemo(() => toValues(settings), [settings]);
    const dirty = JSON.stringify(values) !== JSON.stringify(saved);

    useEffect(() => setValues(toValues(settings)), [settings]);
    useEffect(() => {
        onDirtyChange(dirty);
        return () => onDirtyChange(false);
    }, [dirty, onDirtyChange]);

    const options = useQuery({
        queryKey: ['akeneoSyncOptions', settings.baseUrl],
        queryFn: () => api.query(akeneoSyncOptionsQuery),
        retry: false,
    });
    const channels = options.data?.akeneoChannels ?? [];
    const trees = options.data?.akeneoCategoryTrees ?? [];
    const languages = options.data?.activeChannel.availableLanguageCodes ?? [];
    const defaultLanguage = options.data?.activeChannel.defaultLanguageCode;
    const channel = channels.find(c => c.code === values.channelCode);

    const changeChannel = async (channelCode: string) => {
        setValues(v => ({ ...v, channelCode }));
        try {
            // Locales differ per Akeneo channel, so start from a fresh suggestion
            const { akeneoSuggestedLocaleMapping } = await api.query(akeneoSuggestedLocaleMappingQuery, {
                channelCode,
            });
            const mapping = Object.fromEntries(
                akeneoSuggestedLocaleMapping.map(m => [m.languageCode, m.locale]),
            );
            setValues(v => (v.channelCode === channelCode ? { ...v, mapping } : v));
        } catch (err) {
            toast.error('Could not suggest locales', { description: errorMessage(err) });
        }
    };

    const saveMutation = useMutation({
        mutationFn: (v: SyncValues) =>
            api.mutate(saveAkeneoSyncSettingsMutation, {
                input: {
                    channelCode: v.channelCode,
                    localeMapping: Object.entries(v.mapping).flatMap(([languageCode, locale]) =>
                        locale ? [{ languageCode: languageCode as LanguageCode, locale }] : [],
                    ),
                    categoryTreeCodes: v.trees,
                    includeCategoryRoot: v.includeRoot,
                    enabled: v.enabled,
                },
            }),
        onSuccess: result => {
            queryClient.setQueryData(queryKey, { akeneoConnectionSettings: result.saveAkeneoSyncSettings });
            toast.success('Sync settings saved');
        },
        onError: err => toast.error('Could not save sync settings', { description: errorMessage(err) }),
    });

    if (options.error) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Could not load options from Akeneo</AlertTitle>
                <AlertDescription>{errorMessage(options.error)}</AlertDescription>
            </Alert>
        );
    }
    if (options.isLoading) {
        return <p className="text-sm text-muted-foreground">Loading options from Akeneo…</p>;
    }

    const defaultUnmapped = !!defaultLanguage && !values.mapping[defaultLanguage];
    const treeItems = trees.map(tree => {
        const suffix = tree.code === channel?.categoryTree ? ' · channel tree' : '';
        return { value: tree.code, label: `${tree.label} (${tree.code})${suffix}` };
    });

    const setMapping = (lang: LanguageCode, value: string | null) =>
        setValues(v => ({
            ...v,
            mapping: { ...v.mapping, [lang]: value && value !== NOT_MAPPED ? value : undefined },
        }));

    return (
        // This block sits inside the connection form; keep Enter in its inputs from submitting it
        <div
            onKeyDown={e => {
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
            }}
        >
            <Section title="Sync" description="When off, no catalog sync runs for this channel.">
                <label className="flex items-center gap-3 text-sm font-medium">
                    <Switch
                        checked={values.enabled}
                        onCheckedChange={enabled => setValues(v => ({ ...v, enabled }))}
                    />
                    Sync enabled
                </label>
            </Section>

            <Section
                title="Source"
                description="Where product data is read from, and which Akeneo locale feeds each Vendure language. Unmapped languages are not synced."
            >
                <Field label="Akeneo channel">
                    <Select
                        items={Object.fromEntries(
                            channels.map(c => [c.code, `${c.label} (${c.categoryTree})`]),
                        )}
                        value={values.channelCode || null}
                        onValueChange={v => v && void changeChannel(v)}
                    >
                        <SelectTrigger className="w-full max-w-sm">
                            <SelectValue placeholder="Select a channel" />
                        </SelectTrigger>
                        <SelectContent>
                            {channels.map(c => (
                                <SelectItem key={c.code} value={c.code}>
                                    {c.label} ({c.categoryTree})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                {channel && (
                    <Field
                        label="Locale mapping"
                        hint="Suggested when you pick a channel; picking another channel replaces it."
                    >
                        <div className="flex flex-col gap-2">
                            {languages.map(lang => (
                                <div key={lang} className="flex items-center gap-3">
                                    <span className="w-28 text-sm">
                                        {lang}
                                        {lang === defaultLanguage && (
                                            <span className="text-muted-foreground"> · default</span>
                                        )}
                                    </span>
                                    <span className="text-muted-foreground" aria-hidden>
                                        →
                                    </span>
                                    <Select
                                        items={{
                                            [NOT_MAPPED]: 'Not mapped',
                                            ...Object.fromEntries(channel.locales.map(l => [l, l])),
                                        }}
                                        value={values.mapping[lang] ?? NOT_MAPPED}
                                        onValueChange={v => setMapping(lang, v)}
                                    >
                                        <SelectTrigger
                                            className="w-40"
                                            aria-label={`Akeneo locale for ${lang}`}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={NOT_MAPPED}>Not mapped</SelectItem>
                                            {channel.locales.map(l => (
                                                <SelectItem key={l} value={l}>
                                                    {l}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                            {defaultUnmapped && (
                                <p className="text-sm text-destructive">
                                    Map a locale to the default language before syncing.
                                </p>
                            )}
                        </div>
                    </Field>
                )}
            </Section>

            <Section
                title="Collections"
                description="Which Akeneo category trees become Vendure collections. Leave empty to manage collections in Vendure only. Collections from trees you remove later are kept."
            >
                <Field label="Category trees">
                    <MultiSelect
                        multiple
                        showSearch
                        items={treeItems}
                        value={values.trees}
                        onChange={trees => setValues(v => ({ ...v, trees }))}
                        placeholder="No trees selected"
                        searchPlaceholder="Search trees…"
                        className="w-full max-w-sm"
                    />
                </Field>
                <label className="flex items-start gap-3">
                    <Switch
                        checked={values.includeRoot}
                        onCheckedChange={includeRoot => setValues(v => ({ ...v, includeRoot }))}
                    />
                    <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">Create root category as a collection</span>
                        <span className="text-sm text-muted-foreground">
                            When off, each tree's top categories become top-level collections.
                        </span>
                    </span>
                </label>
            </Section>

            <div className="flex items-center justify-end gap-3 border-t pt-4">
                {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
                <Button
                    type="button"
                    disabled={!dirty || !values.channelCode || saveMutation.isPending}
                    onClick={() => saveMutation.mutate(values)}
                >
                    {saveMutation.isPending ? 'Saving…' : 'Save sync settings'}
                </Button>
            </div>
        </div>
    );
}

/** A settings row: what it is and why on the left, the controls on the right. */
function Section({
    title,
    description,
    children,
}: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
    return (
        <section className="grid gap-4 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-3 md:gap-8">
            <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex flex-col gap-5 md:col-span-2">{children}</div>
        </section>
    );
}

function Field({
    label,
    hint,
    children,
}: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
    return (
        <div className="flex flex-col gap-2">
            <Label>{label}</Label>
            {children}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}
