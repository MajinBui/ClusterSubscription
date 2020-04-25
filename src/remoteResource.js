const Mustache = require('mustache');

const log = require('../lib/bunyan-api').createLogger('cluster-subscription');

const { KubeClass, KubeApiConfig } = require('@razee/kubernetes-util');
const kubeApiConfig = KubeApiConfig();
const kc = new KubeClass(kubeApiConfig);

const ORG_ID = process.env.RAZEE_ORG_ID;
const ORG_KEY = process.env.RAZEE_ORG_KEY;
const RAZEE_API = process.env.RAZEE_API;

if (!ORG_ID) {
  throw 'Please specify process.env.RAZEE_ORG_ID';
}
if (!ORG_KEY) {
  throw 'Please specify process.env.RAZEE_ORG_KEY';
}
if (!RAZEE_API) {
  throw 'Please specify process.env.RAZEE_API';
}

// strip any trailing / from RAZEE_API
const regex = /\/*$/gi;
const API_HOST = RAZEE_API.replace(regex, '');

const API_VERSION = 'deploy.razee.io/v1alpha2';
const KIND = 'RemoteResource';
const NAMESPACE = process.env.NAMESPACE;

const requestsTemplate = `{
  "options": {
    "url": "{{{url}}}",
    "headers": {
      "razee-org-key": "{{orgKey}}"
    }
  }
}`;
  
const createRemoteResources = async (subscriptions) => {
  const krm = await kc.getKubeResourceMeta(API_VERSION, KIND, 'update');
  subscriptions.map( async sub => {
    const url = `${API_HOST}/${sub.url}`;
    const rendered = Mustache.render(requestsTemplate, { url: url, orgKey: ORG_KEY });
    const parsed = JSON.parse(rendered);
    const resourceName = `clustersubscription-${sub.subscription_name}`;
    const resourceTemplate = {
      'apiVersion': API_VERSION,
      'kind': KIND,
      'metadata': {
        'namespace': NAMESPACE,
        'name': resourceName,
        'labels': {
          'razee/watch-resource': 'lite'
        }
      },
      'spec': {
        'requests': []
      }
    };
    resourceTemplate.spec.requests.push(parsed);

    const opt = { simple: false, resolveWithFullResponse: true };

    const uri = krm.uri({ name: resourceName, namespace: NAMESPACE });
    const get = await krm.get(resourceName, NAMESPACE, opt);
    if (get.statusCode === 200) {
    // the remote resource already exists so use mergePatch to apply the resource
      log.info(`Attempting mergePatch for an existing resource ${uri}`);
      const mergeResult = await krm.mergePatch(resourceName, NAMESPACE, resourceTemplate, opt);
      if (mergeResult.statusCode === 200) {
        log.info('mergePatch successful', mergeResult.statusCode, mergeResult.statusMessage, mergeResult.body);
      } else {
        log.error('mergePatch error', mergeResult.statusCode, mergeResult.statusMessage, mergeResult.body);
      }
    } else if (get.statusCode === 404) {
    // the remote resource does not exist so use post to apply the resource
      log.info(`Attempting post for a new resource ${uri}`);
      const postResult = await krm.post(resourceTemplate, opt);
      if (postResult.statusCode === 200 || postResult.statusCode === 201) {
        log.info('post successful', postResult.statusCode, postResult.statusMessage, postResult.body);
      } else {
        log.error('post error', postResult.statusCode, postResult.statusMessage, postResult.body);
      }
    } else {
      log.error(`Get ${get.statusCode} ${uri}`);
    }

  });

};

exports.createRemoteResources = createRemoteResources;
