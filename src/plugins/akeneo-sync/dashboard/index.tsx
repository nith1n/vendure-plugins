import { defineDashboardExtension } from '@vendure/dashboard';
import { PlugIcon } from 'lucide-react';

import { AkeneoSettingsPage } from './akeneo-settings-page';

defineDashboardExtension({
    routes: [
        {
            path: '/akeneo-sync',
            loader: () => ({ breadcrumb: 'Akeneo Sync' }),
            navMenuItem: {
                id: 'akeneo-settings',
                title: 'Akeneo Sync',
                sectionId: 'settings',
                icon: PlugIcon,
                requiresPermission: ['ManageAkeneoSync'],
            },
            component: () => <AkeneoSettingsPage />,
        },
    ],
});
