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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
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
}

function toValues(settings: Settings): SyncValues {
    return {
        channelCode: settings.channelCode ?? '',
        mapping: Object.fromEntries(settings.localeMapping.map(m => [m.languageCode, m.locale])),
        trees: settings.categoryTreeCodes,
        includeRoot: settings.includeCategoryRoot,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

export function AkeneoSyncSettingsBlock({
    settings,
    queryKey,
}: Readonly<{ settings: Settings | null | undefined; queryKey: string[] }>) {
    if (!settings) {
        return <p className="text-sm text-muted-foreground">Save the connection first.</p>;
    }
    // Remount when the instance changes, so options and values start fresh
    return <SyncSettingsForm key={settings.baseUrl} settings={settings} queryKey={queryKey} />;
}

function SyncSettingsForm({ settings, queryKey }: Readonly<{ settings: Settings; queryKey: string[] }>) {
    const queryClient = useQueryClient();
    const [values, setValues] = useState(() => toValues(settings));
    const saved = useMemo(() => toValues(settings), [settings]);

    useEffect(() => setValues(toValues(settings)), [settings]);

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

    const dirty = JSON.stringify(values) !== JSON.stringify(saved);
    const defaultUnmapped = !!defaultLanguage && !values.mapping[defaultLanguage];
    const treeItems = trees.map(tree => {
        const suffix = tree.code === channel?.categoryTree ? ' · channel tree' : '';
        return { value: tree.code, label: `${tree.label} (${tree.code})${suffix}` };
    });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <Label>Akeneo channel</Label>
                <Select
                    items={Object.fromEntries(channels.map(c => [c.code, `${c.label} (${c.categoryTree})`]))}
                    value={values.channelCode || null}
                    onValueChange={v => v && void changeChannel(v)}
                >
                    <SelectTrigger className="w-full max-w-md">
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
                <p className="text-sm text-muted-foreground">
                    Product values, locales and currencies are read from this channel.
                </p>
            </div>

            {channel && (
                <div className="flex flex-col gap-2">
                    <Label>Locale mapping</Label>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Vendure language</TableHead>
                                <TableHead>Akeneo locale</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {languages.map(lang => (
                                <TableRow key={lang}>
                                    <TableCell>
                                        {lang}
                                        {lang === defaultLanguage && (
                                            <span className="text-muted-foreground"> (default)</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            items={{
                                                [NOT_MAPPED]: 'Not mapped',
                                                ...Object.fromEntries(channel.locales.map(l => [l, l])),
                                            }}
                                            value={values.mapping[lang] ?? NOT_MAPPED}
                                            onValueChange={v =>
                                                setValues(s => ({
                                                    ...s,
                                                    mapping: {
                                                        ...s.mapping,
                                                        [lang]: v && v !== NOT_MAPPED ? v : undefined,
                                                    },
                                                }))
                                            }
                                        >
                                            <SelectTrigger className="w-48">
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
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {defaultUnmapped && (
                        <p className="text-sm text-destructive">
                            Map a locale to the default language before syncing.
                        </p>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-2">
                <Label>Category trees to sync as collections</Label>
                <MultiSelect
                    multiple
                    showSearch
                    items={treeItems}
                    value={values.trees}
                    onChange={trees => setValues(v => ({ ...v, trees }))}
                    placeholder="No trees selected"
                    searchPlaceholder="Search trees…"
                    className="w-full max-w-md"
                />
                <p className="text-sm text-muted-foreground">
                    Leave empty to manage collections in Vendure only. Collections from trees you remove later
                    are kept.
                </p>
            </div>

            <div className="flex items-start gap-3">
                <Switch
                    checked={values.includeRoot}
                    onCheckedChange={includeRoot => setValues(v => ({ ...v, includeRoot }))}
                />
                <div className="flex flex-col gap-1">
                    <Label>Create root category as a collection</Label>
                    <p className="text-sm text-muted-foreground">
                        When off, the children of each tree root become top-level collections.
                    </p>
                </div>
            </div>

            <div>
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
