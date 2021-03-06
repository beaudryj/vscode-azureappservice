/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionModels } from 'azure-arm-resource';
import WebSiteManagementClient = require('azure-arm-website');
import * as opn from 'opn';
import * as path from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as WebSiteModels from '../../node_modules/azure-arm-website/lib/models';
import * as util from '../util';
import { AppServiceDataProvider } from './AppServiceExplorer';
import { AzureAccountWrapper } from '../AzureAccountWrapper';
import { KuduClient, webJob } from '../KuduClient';
import { NodeBase } from './NodeBase';



export class WebJobsNode extends NodeBase {
    constructor(readonly site: WebSiteModels.Site,
        readonly subscription: SubscriptionModels.Subscription,
        treeDataProvider: AppServiceDataProvider,
        parentNode: NodeBase) {
        super('WebJobs', treeDataProvider, parentNode);
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: "webJobs",
            iconPath: {
                light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'WebJobs_color.svg'),
                dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'WebJobs_color.svg')
            }
        }
    }

    async getChildren(): Promise<NodeBase[]> {
        const nodes: NodeBase[] = [];
        const webAppClient = new WebSiteManagementClient(this.azureAccount.getCredentialByTenantId(this.subscription.tenantId), this.subscription.subscriptionId);
        const user = await util.getWebAppPublishCredential(webAppClient, this.site);
        const kuduClient = new KuduClient(this.site.name, user.publishingUserName, user.publishingPassword);

        const jobList: webJob[] = await kuduClient.listAllWebJobs();

        for (let job of jobList) {
            nodes.push(new NodeBase(job.name, this.getTreeDataProvider(), this));
        }
        return nodes;
    }

    openInPortal(): void {
        const portalEndpoint = 'https://portal.azure.com';
        const deepLink = `${portalEndpoint}/${this.subscription.tenantId}/#resource${this.site.id}/webJobs`;
        opn(deepLink);
    }

    private get azureAccount(): AzureAccountWrapper {
        return this.getTreeDataProvider<AppServiceDataProvider>().azureAccount;
    }
}