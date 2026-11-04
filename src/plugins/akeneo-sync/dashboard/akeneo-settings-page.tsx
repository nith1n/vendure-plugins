import {
    ActionBarItem,
    Alert,
    AlertDescription,
    AlertTitle,
    api,
    Badge,
    Button,
    DetailFormGrid,
    FormFieldWrapper,
    Input,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    PasswordInput,
    Switch,
} from '@vendure/dashboard';
import type { ResultOf } from '@/gql';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
    akeneoSettingsQuery,
    saveAkeneoSettingsMutation,
    validateAkeneoCredentialsMutation,
} from './akeneo-settings.graphql';
import { AkeneoCategorySyncBlock } from './akeneo-category-sync-block';
import { AkeneoSyncSettingsBlock } from './akeneo-sync-settings-block';

const pageId = 'akeneo-settings';
const queryKey = ['akeneoConnectionSettings'];
const permission = 'ManageAkeneoSync';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type TestResult = ResultOf<typeof validateAkeneoCredentialsMutation>['validateAkeneoCredentials'];

interface FormValues {
    baseUrl: string;
    clientId: string;
    username: string;
    secret: string;
    password: string;
    enabled: boolean;
}

function toFormValues(settings: Settings | null | undefined): FormValues {
    return {
        baseUrl: settings?.baseUrl ?? '',
        clientId: settings?.clientId ?? '',
        username: settings?.username ?? '',
        // Secrets are write-only: the field stays empty and blank means "keep the stored value".
        secret: '',
        password: '',
        enabled: settings?.enabled ?? true,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

export function AkeneoSettingsPage() {
    const queryClient = useQueryClient();
    const [testResult, setTestResult] = useState<TestResult | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey,
        queryFn: () => api.query(akeneoSettingsQuery),
    });
    const settings = data?.akeneoConnectionSettings;
    const isNew = !settings;

    const form = useForm<FormValues>({ defaultValues: toFormValues(undefined), mode: 'onChange' });

    useEffect(() => {
        if (data) form.reset(toFormValues(data.akeneoConnectionSettings));
    }, [data, form]);

    const saveMutation = useMutation({
        mutationFn: (values: FormValues) =>
            api.mutate(saveAkeneoSettingsMutation, {
                input: {
                    baseUrl: values.baseUrl,
                    clientId: values.clientId,
                    username: values.username,
                    secret: values.secret || undefined,
                    password: values.password || undefined,
                    enabled: values.enabled,
                },
            }),
        onSuccess: result => {
            queryClient.setQueryData(queryKey, {
                akeneoConnectionSettings: result.saveAkeneoConnectionSettings,
            });
            setTestResult(null);
            toast.success('Akeneo connection saved');
        },
        onError: err => toast.error('Could not save Akeneo connection', { description: errorMessage(err) }),
    });

    const testMutation = useMutation({
        mutationFn: (values: FormValues) =>
            api.mutate(validateAkeneoCredentialsMutation, {
                // Blank fields fall back to the stored settings on the server.
                input: {
                    baseUrl: values.baseUrl || undefined,
                    clientId: values.clientId || undefined,
                    username: values.username || undefined,
                    secret: values.secret || undefined,
                    password: values.password || undefined,
                },
            }),
        onSuccess: async result => {
            const outcome = result.validateAkeneoCredentials;
            setTestResult(outcome);
            if (outcome.persisted) await queryClient.invalidateQueries({ queryKey });
            if (outcome.valid) toast.success('Connected to Akeneo');
            else toast.error('Akeneo connection failed', { description: outcome.message ?? undefined });
        },
        onError: err => toast.error('Could not test connection', { description: errorMessage(err) }),
    });

    const submitHandler = form.handleSubmit(values => saveMutation.mutate(values));
    const busy = saveMutation.isPending || testMutation.isPending;

    if (error) {
        return (
            <Page pageId={pageId}>
                <PageTitle>Akeneo Sync</PageTitle>
                <PageLayout>
                    <PageBlock column="main" blockId="load-error">
                        <Alert variant="destructive">
                            <AlertTitle>Could not load Akeneo settings</AlertTitle>
                            <AlertDescription>{errorMessage(error)}</AlertDescription>
                        </Alert>
                    </PageBlock>
                </PageLayout>
            </Page>
        );
    }

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler}>
            <PageTitle>Akeneo Sync</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="test-button" requiresPermission={[permission]}>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy || isLoading}
                        onClick={() => testMutation.mutate(form.getValues())}
                    >
                        {testMutation.isPending ? 'Testing…' : 'Test connection'}
                    </Button>
                </ActionBarItem>
                <ActionBarItem itemId="save-button" requiresPermission={[permission]}>
                    <Button type="submit" disabled={busy || isLoading || !form.formState.isDirty}>
                        {saveMutation.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="connection" title="Connection">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="baseUrl"
                            label="Akeneo URL"
                            description="Just the host, e.g. https://acme.cloud.akeneo.com"
                            rules={{ required: 'The Akeneo URL is required' }}
                            render={({ field }) => (
                                <Input {...field} placeholder="https://acme.cloud.akeneo.com" />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="clientId"
                            label="Client ID"
                            rules={{ required: 'The client ID is required' }}
                            render={({ field }) => <Input {...field} autoComplete="off" />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="secret"
                            label="Secret"
                            description={
                                settings?.hasSecret
                                    ? 'Saved. Leave blank to keep the current secret.'
                                    : undefined
                            }
                            rules={{ required: isNew ? 'The secret is required' : false }}
                            render={({ field }) => (
                                <PasswordInput
                                    {...field}
                                    autoComplete="new-password"
                                    placeholder={settings?.hasSecret ? '••••••••' : undefined}
                                />
                            )}
                        />
                        <div />
                        <FormFieldWrapper
                            control={form.control}
                            name="username"
                            label="API username"
                            rules={{ required: 'The API username is required' }}
                            render={({ field }) => <Input {...field} autoComplete="off" />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="password"
                            label="API password"
                            description={
                                settings?.hasPassword
                                    ? 'Saved. Leave blank to keep the current password.'
                                    : undefined
                            }
                            rules={{ required: isNew ? 'The password is required' : false }}
                            render={({ field }) => (
                                <PasswordInput
                                    {...field}
                                    autoComplete="new-password"
                                    placeholder={settings?.hasPassword ? '••••••••' : undefined}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock column="main" blockId="sync-settings" title="Sync settings">
                    <AkeneoSyncSettingsBlock settings={settings} queryKey={queryKey} />
                </PageBlock>
                <PageBlock column="side" blockId="status" title="Status">
                    <ConnectionStatus settings={settings} testResult={testResult} />
                </PageBlock>
                <PageBlock column="side" blockId="sync" title="Sync">
                    <FormFieldWrapper
                        control={form.control}
                        name="enabled"
                        label="Enabled"
                        description="When off, no catalog sync runs for this channel."
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="side" blockId="category-sync" title="Category sync">
                    <AkeneoCategorySyncBlock settings={settings} />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

const statusBadge = {
    VALID: { label: 'Connected', variant: 'success' },
    INVALID: { label: 'Failed', variant: 'destructive' },
    UNTESTED: { label: 'Not tested', variant: 'outline' },
} as const;

function ConnectionStatus({
    settings,
    testResult,
}: Readonly<{ settings: Settings | null | undefined; testResult: TestResult | null }>) {
    if (!settings && !testResult) {
        return <p className="text-sm text-muted-foreground">Not configured yet.</p>;
    }
    // A test of unsaved edits is not recorded on the stored settings, so show it separately.
    const showUnsavedTest = testResult && !testResult.persisted;
    return (
        <div className="flex flex-col gap-3 text-sm">
            {settings && (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Saved connection</span>
                        <Badge variant={statusBadge[settings.lastValidationStatus].variant}>
                            {statusBadge[settings.lastValidationStatus].label}
                        </Badge>
                    </div>
                    {settings.lastValidatedAt && (
                        <span className="text-muted-foreground">
                            Last tested {new Date(settings.lastValidatedAt).toLocaleString()}
                        </span>
                    )}
                    {settings.lastValidationError && (
                        <span className="text-destructive">{settings.lastValidationError}</span>
                    )}
                </div>
            )}
            {showUnsavedTest && (
                <Alert variant={testResult.valid ? 'default' : 'destructive'}>
                    <AlertTitle>
                        {testResult.valid ? 'Unsaved changes work' : 'Unsaved changes failed'}
                    </AlertTitle>
                    <AlertDescription>
                        {testResult.valid ? 'Save to keep these credentials.' : testResult.message}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}
