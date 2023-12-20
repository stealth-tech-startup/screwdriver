'use strict';

const { assert } = require('chai');
const badgeMaker = require('badge-maker');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testPipeline = require('./data/pipeline.json');
const testTemplate = require('./data/pipeline-template.json');
const testTemplates = require('./data/pipelineTemplates.json');
const testTemplateGet = testTemplates[0];
const testTemplateVersions = require('./data/pipelineTemplateVersions.json');
const testTemplateVersionsGet = require('./data/pipelineTemplateVersion.json');
const testTemplateTags = require('./data/pipelineTemplateTags.json');
const TEMPLATE_INVALID = require('./data/pipeline-template-validator.missing-version.json');
const TEMPLATE_VALID = require('./data/pipeline-template-validator.input.json');
const TEMPLATE_VALID_NEW_VERSION = require('./data/pipeline-template-create.input.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateObj = obj => {
    const mock = hoek.clone(obj);

    mock.toJson = sinon.stub().returns(obj);

    return mock;
};

const getTemplateMocks = templates => {
    if (Array.isArray(templates)) {
        return templates.map(decorateObj);
    }

    return decorateObj(templates);
};

const getPipelineMocks = pipelines => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decorateObj);
    }

    return decorateObj(pipelines);
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
    let collectionFactoryMock;
    let eventFactoryMock;
    let tokenFactoryMock;
    let bannerFactoryMock;
    let jobFactoryMock;
    let stageFactoryMock;
    let triggerFactoryMock;
    let secretFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let scmMock;
    let pipelineTemplateFactoryMock;
    let pipelineTemplateVersionFactoryMock;
    let pipelineTemplateTagFactoryMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';

    before(() => {
        sinon.stub(badgeMaker, 'makeBadge').callsFake(format => `${format.label}: ${format.message}`);
    });

    beforeEach(async () => {
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            update: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getScmContexts: sinon.stub(),
                parseUrl: sinon.stub(),
                decorateUrl: sinon.stub(),
                getCommitSha: sinon.stub().resolves('sha'),
                addDeployKey: sinon.stub(),
                getReadOnlyInfo: sinon.stub().returns({ readOnlyEnabled: false }),
                getDisplayName: sinon.stub().returns()
            }
        };
        userFactoryMock = {
            get: sinon.stub(),
            scm: {
                parseUrl: sinon.stub(),
                openPr: sinon.stub()
            }
        };
        collectionFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub()
        };
        eventFactoryMock = {
            create: sinon.stub().resolves(null),
            list: sinon.stub().resolves(null)
        };
        stageFactoryMock = {
            list: sinon.stub()
        };
        tokenFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };
        triggerFactoryMock = {
            getTriggers: sinon.stub()
        };
        bannerFactoryMock = {
            scm: {
                getDisplayName: sinon.stub().returns()
            }
        };
        secretFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub()
        };
        bannerMock = {
            name: 'banners',
            register: s => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
            }
        };
        screwdriverAdminDetailsMock = sinon.stub();
        pipelineTemplateFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub(),
            create: sinon.stub()
        };
        pipelineTemplateVersionFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            get: sinon.stub(),
            getWithMetadata: sinon.stub()
        };

        pipelineTemplateTagFactoryMock = {
            list: sinon.stub(),
            get: sinon.stub(),
            create: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            stageFactory: stageFactoryMock,
            triggerFactory: triggerFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            collectionFactory: collectionFactoryMock,
            tokenFactory: tokenFactoryMock,
            bannerFactory: bannerFactoryMock,
            secretFactory: secretFactoryMock,
            pipelineTemplateFactory: pipelineTemplateFactoryMock,
            pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock,
            pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
            ecosystem: {
                badges: '{{subject}}/{{status}}/{{color}}'
            }
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register([
            { plugin: bannerMock },
            {
                plugin,
                options: {
                    password,
                    scm: scmMock,
                    admins: ['github:batman']
                }
            },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/secrets'),
                options: {
                    password
                }
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    after(() => {
        sinon.restore();
    });

    describe('POST /pipeline/template', () => {
        let options;
        let templateMock;
        const testId = 123;
        let expected;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/pipeline/template',
                payload: TEMPLATE_VALID,
                auth: {
                    credentials: {
                        scope: ['build'],
                        pipelineId: 123
                    },
                    strategy: ['token']
                }
            };

            expected = {
                namespace: 'template_namespace',
                name: 'template_name',
                version: '1.2.3',
                description: 'template description',
                maintainer: 'name@domain.org',
                config: {
                    jobs: { main: { steps: [{ init: 'npm install' }, { test: 'npm test' }] } },
                    shared: {},
                    parameters: {}
                },
                pipelineId: 123
            };

            templateMock = getTemplateMocks(testTemplate);
            pipelineTemplateVersionFactoryMock.create.resolves(templateMock);
            pipelineTemplateFactoryMock.get.resolves(templateMock);
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock.pipelineId = 321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('creates template if template does not exist yet', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, testTemplate);
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(pipelineTemplateFactoryMock.get, {
                    name: 'template_name',
                    namespace: 'template_namespace'
                });
                assert.calledWith(pipelineTemplateVersionFactoryMock.create, expected, pipelineTemplateFactoryMock);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('creates template if has good permission and it is a new version', () => {
            options.payload = TEMPLATE_VALID_NEW_VERSION;
            expected.version = '1.2';
            pipelineTemplateFactoryMock.get.resolves(templateMock);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, testTemplate);
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(pipelineTemplateFactoryMock.get, {
                    name: 'template_name',
                    namespace: 'template_namespace'
                });
                assert.calledWith(pipelineTemplateVersionFactoryMock.create, expected, pipelineTemplateFactoryMock);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the template model fails to create', () => {
            const testError = new Error('templateModelCreateError');

            pipelineTemplateVersionFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when the template is invalid', () => {
            options.payload = TEMPLATE_INVALID;
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });
    });

    describe('POST /pipeline/template/validate', () => {
        it('returns OK for a successful template yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: TEMPLATE_VALID
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload, {
                        errors: [],
                        template: {
                            namespace: 'template_namespace',
                            name: 'template_name',
                            version: '1.2.3',
                            description: 'template description',
                            maintainer: 'name@domain.org',
                            config: {
                                jobs: { main: { steps: [{ init: 'npm install' }, { test: 'npm test' }] } },
                                shared: {},
                                parameters: {}
                            }
                        }
                    });
                }));

        it('returns OK and error yaml for bad yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: TEMPLATE_INVALID
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload.template, {
                        namespace: 'template_namespace',
                        name: 'template_name',
                        description: 'template description',
                        maintainer: 'name@domain.org',
                        config: {
                            jobs: { main: { steps: [{ init: 'npm install' }, { test: 'npm test' }] } }
                        }
                    });

                    assert.deepEqual(payload.errors, [
                        {
                            context: {
                                key: 'version',
                                label: 'version'
                            },
                            message: '"version" is required',
                            path: ['version'],
                            type: 'any.required'
                        }
                    ]);
                }));

        it('returns BAD REQUEST for template that cannot be parsed', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: {
                        yaml: 'error: :'
                    }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /YAMLException/);
                }));

        it('returns BAD REQUEST for invalid API input', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: { yaml: 1 }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /Invalid request payload input/);
                }));
    });

    describe('GET /pipeline/templates', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.list.resolves(testTemplates);
        });

        it('returns 200 for getting all templates', () => {
            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplates);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 and all templates with sortBy query', () => {
            options.url = '/pipeline/templates?sortBy=name';

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplates);
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineTemplateFactoryMock.list, {
                    sortBy: 'name',
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with pagination', () => {
            pipelineTemplateFactoryMock.list.resolves(testTemplates);
            options.url = '/pipeline/templates?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplates);
                assert.calledWith(pipelineTemplateFactoryMock.list, {
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });
    });

    describe('GET /pipeline/templates/{namespace}/{name}/versions', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates/screwdriver/nodejs/versions',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateVersionFactoryMock.list.resolves(testTemplateVersions);
        });

        it('returns 200 for getting all template versions for name and namespace', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateVersions);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and all versions for a pipeline template name and namespace with pagination', () => {
            pipelineTemplateVersionFactoryMock.list.resolves(testTemplateVersions);
            options.url = '/pipeline/templates/screwdriver/nodejs/versions?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplateVersions);
                assert.calledWith(pipelineTemplateVersionFactoryMock.list, {
                    params: {
                        name: 'nodejs',
                        namespace: 'screwdriver'
                    },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.list.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateVersionFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/templates/{namespace}/{name}/tags', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates/screwdriver/nodejs/tags',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateTagFactoryMock.list.resolves(testTemplateTags);
        });

        it('returns 200 for getting all template tags for name and namespace', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateTags);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and all tags for a pipeline template name and namespace with pagination', () => {
            options.url = '/pipeline/templates/screwdriver/nodejs/tags?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplateTags);
                assert.calledWith(pipelineTemplateTagFactoryMock.list, {
                    params: {
                        name: 'nodejs',
                        namespace: 'screwdriver'
                    },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and an empty array when there are no template tags', () => {
            pipelineTemplateTagFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, []);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the pipeline template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateTagFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{namespace}/{name}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/screwdriver/nodejs',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.get.resolves(testTemplateGet);
        });

        it('returns 200 for getting a pipeline template', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when pipeline template does not exist', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the pipeline template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{id}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/123',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.get.resolves(testTemplateGet);
        });

        it('returns 200 for getting a template', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when template does not exist', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{namespace}/{name}/{versionOrTag}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/screwdriver/nodejs/1.2.3',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(testTemplateVersionsGet);
        });

        it('returns 200 for getting a template', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateVersionsGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateVersionFactoryMock.getWithMetadata.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipeline/template/{namespace}/{name}/tags/{tag}', () => {
        let options;
        let templateMock;
        const testId = 123;
        let pipeline;
        const payload = {
            version: '1.2.3'
        };
        const testTemplateTag = decorateObj(hoek.merge({ id: 123 }, payload));

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/pipeline/template/screwdriver/nodejs/tags/stable',
                payload: {
                    version: '1.2.3'
                },
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipeline = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.resolves(pipeline);
            templateMock = getTemplateMocks(testTemplate);
            pipelineTemplateVersionFactoryMock.get.resolves(templateMock);
        });

        it('creates template tag if template tag does not exist yet', () => {
            pipelineTemplateTagFactoryMock.create.resolves(testTemplateTag);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, hoek.merge({ id: 123 }, payload));
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(pipelineTemplateVersionFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    version: '1.2.3'
                });
                assert.calledWith(pipelineTemplateTagFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    tag: 'stable'
                });
                assert.calledWith(pipelineTemplateTagFactoryMock.create, {
                    namespace: 'screwdriver',
                    name: 'nodejs',
                    tag: 'stable',
                    version: '1.2.3'
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('updates template version if the tag already exists', () => {
            const template = hoek.merge(
                {
                    update: sinon.stub().resolves(testTemplateTag)
                },
                testTemplateTag
            );

            pipelineTemplateTagFactoryMock.get.resolves(template);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result.version, template.version);
                assert.calledWith(pipelineTemplateVersionFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    version: '1.2.3'
                });
                assert.calledWith(pipelineTemplateTagFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    tag: 'stable'
                });
                assert.calledOnce(template.update);
                assert.notCalled(pipelineTemplateVersionFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock = getTemplateMocks(testTemplate);
            templateMock.pipelineId = 321;
            pipelineTemplateVersionFactoryMock.get.resolves(templateMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });
});
