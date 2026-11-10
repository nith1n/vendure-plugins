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
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@vendure/dashboard';
import type { ResultOf } from './graphql';
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
/** Base UI selects need a non-empty value for the "not set" option. */
const NOT_SET = '__not_set__';
const TEXT_TYPES = ['pim_catalog_text', 'pim_catalog_textarea'];
const PRICE_TYPE = 'pim_catalog_price_collection';
const IMAGE_TYPES = ['pim_catalog_image', 'pim_catalog_asset_collection'];

interface SyncValues {
    channelCode: string;
    /** Vendure language -> Akeneo locale; missing means not mapped. */
    mapping: Partial<Record<LanguageCode, string>>;
    trees: string[];
    includeRoot: boolean;
    enabled: boolean;
    /** Empty uses each family's label attribute. */
    nameAttribute: string;
    /** Empty leaves descriptions to Vendure. */
    descriptionAttribute: string;
    /** Empty leaves prices to Vendure. */
    priceAttribute: string;
    syncImages: boolean;
    overrides: FamilyOverrideValues[];
}

/** Empty strings and lists use the default. */
interface FamilyOverrideValues {
    family: string;
    nameAttribute: string;
    descriptionAttribute: string;
    priceAttribute: string;
    imageAttributes: string[];
}

type AttributeChoice = { code: string; label: string; type: string };
type FamilyOption = { code: string; label: string; attributes: string[] };

function toValues(settings: Settings): SyncValues {
    return {
        channelCode: settings.channelCode ?? '',
        mapping: Object.fromEntries(settings.localeMapping.map(m => [m.languageCode, m.locale])),
        trees: settings.categoryTreeCodes,
        includeRoot: settings.includeCategoryRoot,
        enabled: settings.enabled,
        nameAttribute: settings.productNameAttribute ?? '',
        descriptionAttribute: settings.productDescriptionAttribute ?? '',
        priceAttribute: settings.productPriceAttribute ?? '',
        syncImages: settings.syncImages,
        overrides: settings.familyOverrides.map(o => ({
            family: o.family,
            nameAttribute: o.nameAttribute ?? '',
            descriptionAttribute: o.descriptionAttribute ?? '',
            priceAttribute: o.priceAttribute ?? '',
            imageAttributes: o.imageAttributes,
        })),
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
    const attributeChoices = options.data?.akeneoAttributeChoices ?? [];
    const textAttributes = attributeChoices.filter(a => TEXT_TYPES.includes(a.type));
    const priceAttributes = attributeChoices.filter(a => a.type === PRICE_TYPE);
    const families = options.data?.akeneoFamilies ?? [];
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
                    productNameAttribute: v.nameAttribute || null,
                    productDescriptionAttribute: v.descriptionAttribute || null,
                    productPriceAttribute: v.priceAttribute || null,
                    syncImages: v.syncImages,
                    familyOverrides: v.overrides.map(o => ({
                        family: o.family,
                        nameAttribute: o.nameAttribute || null,
                        descriptionAttribute: o.descriptionAttribute || null,
                        priceAttribute: o.priceAttribute || null,
                        imageAttributes: o.imageAttributes,
                    })),
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
            <Tabs defaultValue="general">
                <TabsList>
                    <TabsTrigger value="general">
                        General
                        {defaultUnmapped && (
                            <span
                                className="size-1.5 rounded-full bg-destructive"
                                aria-label="Needs attention"
                            />
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="collections">Collections</TabsTrigger>
                    <TabsTrigger value="products">Products</TabsTrigger>
                    <TabsTrigger value="families">
                        Family overrides
                        {values.overrides.length > 0 && (
                            <span className="text-muted-foreground">{values.overrides.length}</span>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="pt-6">
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
                </TabsContent>

                <TabsContent value="collections" className="pt-6">
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
                                <span className="text-sm font-medium">
                                    Create root category as a collection
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    When off, each tree's top categories become top-level collections.
                                </span>
                            </span>
                        </label>
                    </Section>
                </TabsContent>

                <TabsContent value="products" className="pt-6">
                    <Section
                        title="Products"
                        description="How Akeneo products become Vendure products and variants. Product models become products, and their products become variants. These defaults apply to every family without an override."
                    >
                        <Field
                            label="Product name"
                            hint="Families often use the SKU as their label attribute, so pick the attribute that holds the real name."
                        >
                            <AttributeSelect
                                attributes={textAttributes}
                                notSetLabel="Family's label attribute"
                                value={values.nameAttribute}
                                onChange={nameAttribute => setValues(v => ({ ...v, nameAttribute }))}
                            />
                        </Field>
                        <Field label="Description" hint="When not set, descriptions are managed in Vendure.">
                            <AttributeSelect
                                attributes={textAttributes}
                                notSetLabel="Not synced"
                                value={values.descriptionAttribute}
                                onChange={descriptionAttribute =>
                                    setValues(v => ({ ...v, descriptionAttribute }))
                                }
                            />
                        </Field>
                        <Field
                            label="Price"
                            hint="Prices in the channel's currencies are copied from this attribute. When not set, prices are managed in Vendure."
                        >
                            <AttributeSelect
                                attributes={priceAttributes}
                                notSetLabel="Not synced"
                                value={values.priceAttribute}
                                onChange={priceAttribute => setValues(v => ({ ...v, priceAttribute }))}
                            />
                        </Field>
                        <label className="flex items-start gap-3">
                            <Switch
                                checked={values.syncImages}
                                onCheckedChange={syncImages => setValues(v => ({ ...v, syncImages }))}
                            />
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Sync images</span>
                                <span className="text-sm text-muted-foreground">
                                    Each family's image attribute becomes the featured image, followed by its
                                    other image attributes. When off, images are managed in Vendure.
                                </span>
                            </span>
                        </label>
                    </Section>
                </TabsContent>

                <TabsContent value="families" className="pt-6">
                    <Section
                        title="Family overrides"
                        description="Only for families whose attributes differ from the defaults. Anything left on “Use default” follows the Products settings."
                    >
                        <FamilyOverrides
                            families={families}
                            attributes={attributeChoices}
                            syncImages={values.syncImages}
                            overrides={values.overrides}
                            onChange={overrides => setValues(v => ({ ...v, overrides }))}
                        />
                    </Section>
                </TabsContent>
            </Tabs>

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

function FamilyOverrides({
    families,
    attributes,
    syncImages,
    overrides,
    onChange,
}: Readonly<{
    families: FamilyOption[];
    attributes: AttributeChoice[];
    syncImages: boolean;
    overrides: FamilyOverrideValues[];
    onChange: (overrides: FamilyOverrideValues[]) => void;
}>) {
    const familyLabel = (code: string) => {
        const family = families.find(f => f.code === code);
        return family ? `${family.label} (${family.code})` : code;
    };
    const addable = families
        .filter(f => !overrides.some(o => o.family === f.code))
        .map(f => ({ value: f.code, label: `${f.label} (${f.code})` }));
    const update = (index: number, patch: Partial<FamilyOverrideValues>) =>
        onChange(overrides.map((o, i) => (i === index ? { ...o, ...patch } : o)));

    return (
        <div className="flex flex-col gap-4">
            {overrides.map((override, index) => {
                const inFamily = new Set(families.find(f => f.code === override.family)?.attributes ?? []);
                const ofType = (types: string[]) =>
                    attributes.filter(a => inFamily.has(a.code) && types.includes(a.type));
                return (
                    <div key={override.family} className="flex flex-col gap-4 rounded-md border p-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold">{familyLabel(override.family)}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onChange(overrides.filter((_, i) => i !== index))}
                            >
                                Remove
                            </Button>
                        </div>
                        <Field label="Product name">
                            <AttributeSelect
                                attributes={ofType(TEXT_TYPES)}
                                notSetLabel="Use default"
                                value={override.nameAttribute}
                                onChange={nameAttribute => update(index, { nameAttribute })}
                            />
                        </Field>
                        <Field label="Description">
                            <AttributeSelect
                                attributes={ofType(TEXT_TYPES)}
                                notSetLabel="Use default"
                                value={override.descriptionAttribute}
                                onChange={descriptionAttribute => update(index, { descriptionAttribute })}
                            />
                        </Field>
                        <Field label="Price">
                            <AttributeSelect
                                attributes={ofType([PRICE_TYPE])}
                                notSetLabel="Use default"
                                value={override.priceAttribute}
                                onChange={priceAttribute => update(index, { priceAttribute })}
                            />
                        </Field>
                        {syncImages && (
                            <Field
                                label="Images"
                                hint="In the order picked; the first image found is featured."
                            >
                                <MultiSelect
                                    multiple
                                    showSearch
                                    items={ofType(IMAGE_TYPES).map(a => ({
                                        value: a.code,
                                        label: `${a.label} (${a.code})`,
                                    }))}
                                    value={override.imageAttributes}
                                    onChange={imageAttributes => update(index, { imageAttributes })}
                                    placeholder="Family's image attributes"
                                    searchPlaceholder="Search attributes…"
                                    className="w-full max-w-sm"
                                />
                            </Field>
                        )}
                    </div>
                );
            })}
            {/* Always unselected: picking a family adds its card */}
            <Select
                items={Object.fromEntries(addable.map(f => [f.value, f.label]))}
                value={null}
                onValueChange={(family: string | null) =>
                    family &&
                    onChange([
                        ...overrides,
                        {
                            family,
                            nameAttribute: '',
                            descriptionAttribute: '',
                            priceAttribute: '',
                            imageAttributes: [],
                        },
                    ])
                }
            >
                <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder={overrides.length ? 'Add another family' : 'Add a family'} />
                </SelectTrigger>
                <SelectContent>
                    {addable.map(f => (
                        <SelectItem key={f.value} value={f.value}>
                            {f.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/** Akeneo attribute picker; the empty value is shown as `notSetLabel`. */
function AttributeSelect({
    attributes,
    notSetLabel,
    value,
    onChange,
}: Readonly<{
    attributes: Array<{ code: string; label: string }>;
    notSetLabel: string;
    value: string;
    onChange: (value: string) => void;
}>) {
    return (
        <Select
            items={{
                [NOT_SET]: notSetLabel,
                ...Object.fromEntries(attributes.map(a => [a.code, `${a.label} (${a.code})`])),
            }}
            value={value || NOT_SET}
            onValueChange={v => onChange(v && v !== NOT_SET ? v : '')}
        >
            <SelectTrigger className="w-full max-w-sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NOT_SET}>{notSetLabel}</SelectItem>
                {attributes.map(a => (
                    <SelectItem key={a.code} value={a.code}>
                        {a.label} ({a.code})
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
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
