const { DatabaseAnalyser, getLogger } = global.DBGATE_PACKAGES['dbgate-tools'];
const jwt = require('jsonwebtoken');

const logger = getLogger('mongoAnalyser');

class Analyser extends DatabaseAnalyser {
  constructor(dbhan, driver, version) {
    super(dbhan, driver, version);
  }

  feedback(obj, extraObject = {}) {
    // Log authorization header status
    if (!this.dbhan.req?.headers?.authorization) {
      logger.debug({
        msg: 'Analyser feedback - No authorization header found'
      });
    }

    // Add user info to message if available
    let message = obj.analysingMessage;
    let hasUserInfo = false;
    let user = null;

    if (this.dbhan.req?.headers?.authorization) {
      try {
        const token = this.dbhan.req.headers.authorization.split(' ')[1];
        const decoded = jwt.decode(token);
        if (decoded?.login) {
          hasUserInfo = true;
          user = decoded.login;
        }
      } catch (err) {
        logger.error({
          msg: 'Error decoding JWT token in feedback',
          error: err.message
        });
      }
    }

    // Remove the analysingMessage from the obj
    delete obj.analysingMessage;
    super.feedback(obj);

    // Force the logger.debug here with user info
    logger.debug({
      hasUserInfo: hasUserInfo,
      loginUser: user,
      ...extraObject
    }, message);
  }

  async _runAnalysis() {
    this.feedback({ analysingMessage: 'Loading collections' });
    const collectionsAndViews = await this.dbhan.getDatabase().listCollections().toArray();
    const collections = collectionsAndViews.filter((x) => x.type == 'collection');
    const views = collectionsAndViews.filter((x) => x.type == 'view');

    this.feedback({ analysingMessage: `Loaded collections from database ${this.dbhan.database} with ${collections.length} collections` }, { database: this.dbhan.database, collections: collections.length });

    let stats;
    try {
      this.feedback({ analysingMessage: 'Loading collection statistics' });
      stats = await Promise.all(
        collections
          .filter((x) => x.type == 'collection')
          .map((x) =>
            this.dbhan
              .getDatabase()
              .collection(x.name)
              .aggregate([{ $collStats: { count: {} } }])
              .toArray()
              .then((resp) => ({ name: x.name, count: resp[0].count }))
          )
      );
      this.feedback({ analysingMessage: `Loaded collection statistics from database ${this.dbhan.database}` }, { database: this.dbhan.database, stats: stats.length });
    } catch (e) {
      // $collStats not supported
      stats = {};
      this.feedback({ analysingMessage: `Collection statistics not supported in database ${this.dbhan.database}` }, { database: this.dbhan.database });
    }

    const res = this.mergeAnalyseResult({
      collections: [
        ...collections.map((x, index) => ({
          pureName: x.name,
          tableRowCount: stats[index]?.count,
          uniqueKey: [{ columnName: '_id' }],
          partitionKey: [{ columnName: '_id' }],
          clusterKey: [{ columnName: '_id' }],
        })),
        ...views.map((x, index) => ({
          pureName: x.name,
          uniqueKey: [{ columnName: '_id' }],
          partitionKey: [{ columnName: '_id' }],
          clusterKey: [{ columnName: '_id' }],
        })),
      ],
    });
    return res;
  }
}

module.exports = Analyser;
