const expect = require('chai').expect,
      mockery = require('mockery'),
      sinon = require('sinon'),
      util = require('util'),
      events = require('events'),
      { PUBSUB_EVENTS, WEBSOCKET_EVENTS, DOCUMENT_STATES } = require('../../../src/lib/constants'),
      noop = () => {};

describe('The wsserver documents module', function() {
  let helpersMock;

  beforeEach(function() {
    helpersMock = {
      getSocketInfo: sinon.stub().returns({ user: {} })
    };
  });

  it('should emit error to only requester if failed to load document state', function(done) {
    const eventEmitter = new events.EventEmitter();

    eventEmitter.use = noop;
    eventEmitter.of = () => eventEmitter;

    function Socket(handshake) {
      this.request = handshake;
      events.EventEmitter.call(this);
    }
    util.inherits(Socket, events.EventEmitter);

    Socket.prototype.join = noop;

    function DocumentMock() {}
    const loadError = new Error('an error');
    const jsonError = {
      code: 500,
      message: 'Server Error',
      details: 'Error while getting document'
    };

    DocumentMock.prototype.load = sinon.stub().returns(Promise.reject(loadError));

    helpersMock.build500Error = sinon.stub().returns(jsonError);

    mockery.registerMock('../lib/document', DocumentMock);
    mockery.registerMock('./helpers', helpersMock);

    const documents = this.helpers.requireBackend('wsserver/documents');

    documents.init(eventEmitter);

    const socket = new Socket();

    eventEmitter.emit('connection', socket);

    process.nextTick(function() {
      socket.emit('subscribe', {
        workGroupId: 'wgrId',
        documentId: 'docId'
      });

      socket.emit = sinon.spy();
      setImmediate(function() {
        expect(DocumentMock.prototype.load).to.have.been.called;
        expect(helpersMock.build500Error).to.have.been.calledWith('Error while getting document', loadError);
        expect(socket.emit).to.have.been.calledWith(WEBSOCKET_EVENTS.DOCUMENT_LOAD_FAILED, jsonError);

        done();
      });
    });
  });

  it('should emit error to all users in room if got PUBSUB_EVENTS.DOCUMENT_DOWNLOAD_FAILED from pubsub', function(done) {
    const emitMock = sinon.spy();
    const ioToMock = sinon.stub().returns({
      emit: emitMock
    });
    const ioMock = {
      use: noop,
      of: () => ({
        on: noop,
        to: ioToMock
      })
    };
    const jsonError = {
      code: 500,
      message: 'Server Error',
      details: 'Error while getting document'
    };

    helpersMock.build500Error = sinon.stub().returns(jsonError);

    mockery.registerMock('../lib/document', {});
    mockery.registerMock('./helpers', helpersMock);

    const documents = this.helpers.requireBackend('wsserver/documents');
    const pubsub = this.helpers.requireBackend('lib/pubsub');

    documents.init(ioMock);

    const data = {
      document: { uuid: '123' },
      error: 'download error'
    };
    pubsub.topic(PUBSUB_EVENTS.DOCUMENT_DOWNLOAD_FAILED).publish(data);

    process.nextTick(function() {
      expect(helpersMock.build500Error).to.have.been.calledWith('Error while getting document', data.error);
      expect(ioToMock).to.have.been.calledWith(data.document.uuid);
      expect(emitMock).to.have.been.calledWith(WEBSOCKET_EVENTS.DOCUMENT_LOAD_FAILED, jsonError);

      done();
    });
  });

  it('should re-download after the document is saved to Linshare if there are users trying to open the document while it is being saved', function(done) {
    const document = {
      uuid: '123',
      setState: sinon.stub().returns(Promise.resolve()),
      save: sinon.stub().returns(Promise.resolve())
    };
    const ioMock = {
      use: noop,
      of: () => ({
        on: noop,
        to: noop,
        adapter: {
          rooms: { [document.uuid]: ['client1', 'client2'] }
        }
      })
    };

    mockery.registerMock('../lib/document', {});

    const documents = this.helpers.requireBackend('wsserver/documents');
    const pubsub = this.helpers.requireBackend('lib/pubsub');

    documents.init(ioMock);

    pubsub.topic(PUBSUB_EVENTS.DOCUMENT_SAVED).publish(document);

    setImmediate(function() {
      expect(document.setState).to.have.been.calledWith(DOCUMENT_STATES.downloading);
      expect(document.save).to.have.been.calledOnce;

      done();
    });
  });

  it('should emit error to users if document is not found', function(done) {
    const eventEmitter = new events.EventEmitter();

    eventEmitter.use = noop;
    eventEmitter.of = () => eventEmitter;

    function Socket(handshake) {
      this.request = handshake;
      events.EventEmitter.call(this);
    }
    util.inherits(Socket, events.EventEmitter);

    Socket.prototype.join = noop;

    function DocumentMock() {}
    const jsonError = {
      code: 404,
      message: 'Not Found',
      details: 'Document not found'
    };

    DocumentMock.prototype.load = () => Promise.resolve();
    DocumentMock.prototype.canBeEdited = () => true;
    DocumentMock.prototype.populateMetadata = sinon.stub().throws(new Error('Document not found'));

    helpersMock.build404Error = sinon.stub().returns(jsonError);

    mockery.registerMock('../lib/document', DocumentMock);
    mockery.registerMock('./helpers', helpersMock);

    const documents = this.helpers.requireBackend('wsserver/documents');

    documents.init(eventEmitter);

    const socket = new Socket();

    eventEmitter.emit('connection', socket);

    process.nextTick(function() {
      socket.emit('subscribe', {
        workGroupId: 'wgrId',
        documentId: 'docId'
      });

      socket.emit = sinon.spy();
      setImmediate(function() {
        expect(DocumentMock.prototype.populateMetadata).to.have.been.called;
        expect(helpersMock.build404Error).to.have.been.called;
        expect(socket.emit).to.have.been.calledWith(WEBSOCKET_EVENTS.DOCUMENT_LOAD_FAILED, jsonError);

        done();
      });
    });
  });
});
