const _ = require('lodash');
const sql = require('./sql');
const jwt = require('jsonwebtoken');

const { DatabaseAnalyser, isTypeString, isTypeNumeric, getLogger } = global.DBGATE_PACKAGES['dbgate-tools'];

const logger = getLogger('dbAnalyser');

function quoteDefaultValue(value) {
  if (value == null) return value;
  if (!isNaN(value) && !isNaN(parseFloat(value))) return value;
  if (_.isString(value) && value.startsWith('CURRENT_')) return value;
  // keep NULL as default value. Is this really necessary?
  if (_.isString(value) && value?.toUpperCase() == 'NULL') return 'NULL';
  if (_.isString(value)) {
    return `'${value.replace("'", "\\'")}'`;
  }
  return value;
}

function normalizeTypeName(typeName) {
  if (/int\(\d+\)/.test(typeName)) return 'int';
  return typeName;
}

function getColumnInfo(
  {
    isNullable,
    extra,
    columnName,
    dataType,
    charMaxLength,
    numericPrecision,
    numericScale,
    defaultValue,
    columnComment,
    columnType,
  },
  driver
) {
  const { quoteDefaultValues } = driver.__analyserInternals;
  let optionsInfo = {};

  const columnTypeTokens = _.isString(columnType) ? columnType.split(' ').map(x => x.trim().toLowerCase()) : [];
  let fullDataType = dataType;
  if (charMaxLength && isTypeString(dataType)) fullDataType = `${dataType}(${charMaxLength})`;
  else if (numericPrecision && numericScale && isTypeNumeric(dataType))
    fullDataType = `${dataType}(${numericPrecision},${numericScale})`;
  else {
    const optionsTypeParts = columnType.match(/^(enum|set)\((.+)\)/i);
    if (optionsTypeParts?.length) {
      fullDataType = columnType;
      optionsInfo.options = optionsTypeParts[2].split(',').map(option => option.substring(1, option.length - 1));
      optionsInfo.canSelectMultipleOptions = optionsTypeParts[1] == 'set';
    }
  }

  return {
    notNull: !isNullable || isNullable == 'NO' || isNullable == 'no',
    autoIncrement: !!(extra && extra.toLowerCase().includes('auto_increment')),
    columnName,
    columnComment,
    dataType: fullDataType,
    defaultValue: quoteDefaultValues ? quoteDefaultValue(defaultValue) : defaultValue,
    isUnsigned: columnTypeTokens.includes('unsigned'),
    isZerofill: columnTypeTokens.includes('zerofill'),
    ...optionsInfo,
  };
}

function getParametersSqlString(parameters = []) {
  if (!parameters?.length) return '';

  return parameters
    .map(i => {
      const mode = i.parameterMode ? `${i.parameterMode} ` : '';
      const dataType = i.dataType ? ` ${i.dataType.toUpperCase()}` : '';
      return mode + i.parameterName + dataType;
    })
    .join(', ');
}

class Analyser extends DatabaseAnalyser {
  constructor(dbhan, driver, version) {
    super(dbhan, driver, version);
  }

  createQuery(resFileName, typeFields, replacements = {}) {
    let res = sql[resFileName];
    res = res.replace('#DATABASE#', this.dbhan.database);
    return super.createQuery(res, typeFields, replacements);
  }

  getRequestedViewNames(allViewNames) {
    return this.getRequestedObjectPureNames('views', allViewNames);
  }

  async _computeSingleObjectId() {
    const { pureName } = this.singleObjectFilter;
    this.singleObjectId = pureName;
  }

  async getViewTexts(allViewNames) {
    const res = {};

    const views = await this.analyserQuery('viewTexts', ['views']);
    for (const view of views.rows) {
      res[view.pureName] = `CREATE VIEW \`${view.pureName}\` AS ${view.viewDefinition}`;
    }

    // for (const viewName of this.getRequestedViewNames(allViewNames)) {
    //   try {
    //     const resp = await this.driver.query(this.pool, `SHOW CREATE VIEW \`${viewName}\``);
    //     res[viewName] = resp.rows[0]['Create View'];
    //   } catch (err) {
    //     console.log('ERROR', err);
    //     res[viewName] = `${err}`;
    //   }
    // }
    return res;
  }

  async _runAnalysis() {
    this.feedback({ analysingMessage: 'Loading tables' });
    const tables = await this.analyserQuery('tables', ['tables']);
    this.feedback({ analysingMessage: `Loaded tables from database ${this.dbhan.database} with ${tables.rows.length} tables` }, { database: this.dbhan.database, rows: tables.rows.length, template: 'tables' });
    this.feedback({ analysingMessage: 'Loading columns' });
    const columns = await this.analyserQuery('columns', ['tables', 'views']);
    this.feedback({ analysingMessage: `Loaded columns from database ${this.dbhan.database} with ${columns.rows.length} columns` }, { database: this.dbhan.database, rows: columns.rows.length, template: 'columns' });
    this.feedback({ analysingMessage: 'Loading primary keys' });
    const pkColumns = await this.analyserQuery('primaryKeys', ['tables']);
    this.feedback({ analysingMessage: `Loaded primary keys from database ${this.dbhan.database} with ${pkColumns.rows.length} primary keys` }, { database: this.dbhan.database, rows: pkColumns.rows.length, template: 'primaryKeys' });
    this.feedback({ analysingMessage: 'Loading foreign keys' });
    const fkColumns = await this.analyserQuery('foreignKeys', ['tables']);
    this.feedback({ analysingMessage: `Loaded foreign keys from database ${this.dbhan.database} with ${fkColumns.rows.length} foreign keys` }, { database: this.dbhan.database, rows: fkColumns.rows.length, template: 'foreignKeys' });
    this.feedback({ analysingMessage: 'Loading views' });
    const views = await this.analyserQuery('views', ['views']);
    this.feedback({ analysingMessage: `Loaded views from database ${this.dbhan.database} with ${views.rows.length} views` }, { database: this.dbhan.database, rows: views.rows.length, template: 'views' });
    this.feedback({ analysingMessage: 'Loading programmables' });
    const programmables = await this.analyserQuery('programmables', ['procedures', 'functions']);
    this.feedback({ analysingMessage: `Loaded procedures and functions from database ${this.dbhan.database} with ${programmables.rows.length} procedures and functions` }, { database: this.dbhan.database, rows: programmables.rows.length, template: 'programmables' });

    const parameters = await this.analyserQuery('parameters', ['procedures', 'functions']);
    this.feedback({ analysingMessage: `Loaded parameters from database ${this.dbhan.database} with ${parameters.rows.length} parameters` }, { database: this.dbhan.database, rows: parameters.rows.length, template: 'parameters' });

    const functionParameters = parameters.rows.filter(x => x.routineType == 'FUNCTION');
    const functionNameToParameters = functionParameters.reduce((acc, row) => {
      if (!acc[row.pureName]) acc[row.pureName] = [];

      acc[row.pureName].push({
        ...row,
        dataType: normalizeTypeName(row.dataType),
      });
      return acc;
    }, {});

    const procedureParameters = parameters.rows.filter(x => x.routineType == 'PROCEDURE');
    const procedureNameToParameters = procedureParameters.reduce((acc, row) => {
      if (!acc[row.pureName]) acc[row.pureName] = [];

      acc[row.pureName].push({
        ...row,
        dataType: normalizeTypeName(row.dataType),
      });
      return acc;
    }, {});

    this.feedback({ analysingMessage: 'Loading view texts' });
    const viewTexts = await this.getViewTexts(views.rows.map(x => x.pureName));
    this.feedback({ analysingMessage: `Loaded view texts from database ${this.dbhan.database} with ${Object.keys(viewTexts).length} views` }, { database: this.dbhan.database, rows: Object.keys(viewTexts).length, template: 'viewTexts' });
    this.feedback({ analysingMessage: 'Loading indexes' });
    const indexes = await this.analyserQuery('indexes', ['tables']);
    this.feedback({ analysingMessage: `Loaded indexes from database ${this.dbhan.database} with ${indexes.rows.length} indexes` }, { database: this.dbhan.database, rows: indexes.rows.length, template: 'indexes' });
    this.feedback({ analysingMessage: 'Loading uniques' });

    this.feedback({ analysingMessage: 'Loading triggers' });
    const triggers = await this.analyserQuery('triggers');
    this.feedback({ analysingMessage: `Loaded triggers from database ${this.dbhan.database} with ${triggers.rows.length} triggers` }, { database: this.dbhan.database, rows: triggers.rows.length, template: 'triggers' });

    this.feedback({ analysingMessage: 'Loading scheduler events' });
    const schedulerEvents = await this.analyserQuery('schedulerEvents');
    this.feedback({ analysingMessage: `Loaded scheduler events from database ${this.dbhan.database} with ${schedulerEvents.rows.length} scheduler events` }, { database: this.dbhan.database, rows: schedulerEvents.rows.length, template: 'schedulerEvents' });

    const uniqueNames = await this.analyserQuery('uniqueNames', ['tables']);
    this.feedback({ analysingMessage: `Loaded unique constraints from database ${this.dbhan.database} with ${uniqueNames.rows.length} unique constraints` }, { database: this.dbhan.database, rows: uniqueNames.rows.length, template: 'uniqueNames' });
    this.feedback({ analysingMessage: 'Finalizing DB structure' });

    const res = {
      tables: tables.rows.map(table => ({
        ...table,
        objectId: table.pureName,
        objectComment: _.isString(table.objectComment) ? table.objectComment : undefined,
        contentHash: _.isDate(table.modifyDate) ? table.modifyDate.toISOString() : table.modifyDate,
        columns: columns.rows.filter(col => col.pureName == table.pureName).map(x => getColumnInfo(x, this.driver)),
        primaryKey: DatabaseAnalyser.extractPrimaryKeys(table, pkColumns.rows),
        foreignKeys: DatabaseAnalyser.extractForeignKeys(table, fkColumns.rows),
        tableRowCount: table.tableRowCount,
        indexes: _.uniqBy(
          indexes.rows.filter(
            idx =>
              idx.tableName == table.pureName && !uniqueNames.rows.find(x => x.constraintName == idx.constraintName)
          ),
          'constraintName'
        ).map(idx => ({
          ..._.pick(idx, ['constraintName', 'indexType']),
          isUnique: !idx.nonUnique,
          columns: indexes.rows
            .filter(col => col.tableName == idx.tableName && col.constraintName == idx.constraintName)
            .map(col => ({
              ..._.pick(col, ['columnName', 'isDescending']),
            })),
        })),

        uniques: _.uniqBy(
          indexes.rows.filter(
            idx => idx.tableName == table.pureName && uniqueNames.rows.find(x => x.constraintName == idx.constraintName)
          ),
          'constraintName'
        ).map(idx => ({
          ..._.pick(idx, ['constraintName']),
          columns: indexes.rows
            .filter(col => col.tableName == idx.tableName && col.constraintName == idx.constraintName)
            .map(col => ({
              ..._.pick(col, ['columnName']),
            })),
        })),
      })),
      views: views.rows.map(view => ({
        ...view,
        objectId: view.pureName,
        contentHash: _.isDate(view.modifyDate) ? view.modifyDate.toISOString() : view.modifyDate,
        columns: columns.rows.filter(col => col.pureName == view.pureName).map(x => getColumnInfo(x, this.driver)),
        createSql: viewTexts[view.pureName],
        requiresFormat: true,
      })),
      procedures: programmables.rows
        .filter(x => x.objectType == 'PROCEDURE')
        .map(x => _.omit(x, ['objectType']))
        .map(x => ({
          ...x,
          createSql: `DELIMITER //\n\nCREATE PROCEDURE \`${x.pureName}\`(${getParametersSqlString(
            procedureNameToParameters[x.pureName]
          )})\n${x.routineDefinition}\n\nDELIMITER ;\n`,
          objectId: x.pureName,
          contentHash: _.isDate(x.modifyDate) ? x.modifyDate.toISOString() : x.modifyDate,
          parameters: procedureNameToParameters[x.pureName],
        })),
      functions: programmables.rows
        .filter(x => x.objectType == 'FUNCTION')
        .map(x => _.omit(x, ['objectType']))
        .map(x => ({
          ...x,
          createSql: `CREATE FUNCTION \`${x.pureName}\`(${getParametersSqlString(
            functionNameToParameters[x.pureName]?.filter(i => i.parameterMode !== 'RETURN')
          )})\nRETURNS ${x.returnDataType} ${x.isDeterministic == 'YES' ? 'DETERMINISTIC' : 'NOT DETERMINISTIC'}\n${
            x.routineDefinition
          }`,
          objectId: x.pureName,
          contentHash: _.isDate(x.modifyDate) ? x.modifyDate.toISOString() : x.modifyDate,
          parameters: functionNameToParameters[x.pureName],
        })),
      triggers: triggers.rows.map(row => ({
        contentHash: row.modifyDate,
        pureName: row.triggerName,
        eventType: row.eventType,
        triggerTiming: row.triggerTiming,
        tableName: row.tableName,
        createSql: `CREATE TRIGGER ${row.triggerName} ${row.triggerTiming} ${row.eventType} ON ${row.tableName} FOR EACH ROW ${row.definition}`,
      })),
      schedulerEvents: schedulerEvents.rows.map(row => ({
        contentHash: _.isDate(row.LAST_ALTERED) ? row.LAST_ALTERED.toISOString() : row.LAST_ALTERED,
        pureName: row.EVENT_NAME,
        createSql: row.CREATE_SQL,
        objectId: row.EVENT_NAME,
        intervalValue: row.INTERVAL_VALUE,
        intervalField: row.INTERVAL_FIELD,
        starts: row.STARTS,
        status: row.STATUS,
        executeAt: row.EXECUTE_AT,
        lastExecuted: row.LAST_EXECUTED,
        eventType: row.EVENT_TYPE,
        definer: row.DEFINER,
        objectTypeField: 'schedulerEvents',
      })),
    };
    this.feedback({ analysingMessage: null });
    return res;
  }

  async _getFastSnapshot() {
    const tableModificationsQueryData = await this.analyserQuery('tableModifications');
    this.feedback({ analysingMessage: `Loaded table modifications from database ${this.dbhan.database} with ${tableModificationsQueryData.rows.length} table modifications` }, { database: this.dbhan.database, rows: tableModificationsQueryData.rows.length, template: 'tableModifications' });
    const procedureModificationsQueryData = await this.analyserQuery('procedureModifications');
    this.feedback({ analysingMessage: `Loaded procedure modifications from database ${this.dbhan.database} with ${procedureModificationsQueryData.rows.length} procedure modifications` }, { database: this.dbhan.database, rows: procedureModificationsQueryData.rows.length, template: 'procedureModifications' });
    const functionModificationsQueryData = await this.analyserQuery('functionModifications');
    this.feedback({ analysingMessage: `Loaded function modifications from database ${this.dbhan.database} with ${functionModificationsQueryData.rows.length} function modifications` }, { database: this.dbhan.database, rows: functionModificationsQueryData.rows.length, template: 'functionModifications' });
    const schedulerEvents = await this.analyserQuery('schedulerEvents');
    this.feedback({ analysingMessage: `Loaded scheduler events from database ${this.dbhan.database} with ${schedulerEvents.rows.length} scheduler events` }, { database: this.dbhan.database, rows: schedulerEvents.rows.length, template: 'schedulerEvents' });

    return {
      tables: tableModificationsQueryData.rows
        .filter(x => x.objectType == 'BASE TABLE')
        .map(x => ({
          ...x,
          objectId: x.pureName,
          contentHash: _.isDate(x.modifyDate) ? x.modifyDate.toISOString() : x.modifyDate,
          tableRowCount: x.tableRowCount,
        })),
      views: tableModificationsQueryData.rows
        .filter(x => x.objectType == 'VIEW')
        .map(x => ({
          ...x,
          objectId: x.pureName,
          contentHash: _.isDate(x.modifyDate) ? x.modifyDate.toISOString() : x.modifyDate,
        })),
      procedures: procedureModificationsQueryData.rows.map(x => ({
        contentHash: x.Modified,
        objectId: x.Name,
        pureName: x.Name,
      })),
      functions: functionModificationsQueryData.rows.map(x => ({
        contentHash: x.Modified,
        objectId: x.Name,
        pureName: x.Name,
      })),
      schedulerEvents: schedulerEvents.rows.map(row => ({
        contentHash: _.isDate(row.LAST_ALTERED) ? row.LAST_ALTERED.toISOString() : row.LAST_ALTERED,
        pureName: row.EVENT_NAME,
        createSql: row.CREATE_SQL,
        objectId: row.EVENT_NAME,
        intervalValue: row.INTERVAL_VALUE,
        intervalField: row.INTERVAL_FIELD,
        starts: row.STARTS,
        status: row.STATUS,
        executeAt: row.EXECUTE_AT,
        lastExecuted: row.LAST_EXECUTED,
        eventType: row.EVENT_TYPE,
        definer: row.DEFINER,
        objectTypeField: 'schedulerEvents',
      })),
    };
  }

  feedback(obj, extraObject = {}) {
    // Log request context with all headers
    // logger.debug({
    //   msg: 'Analyser feedback - Request context',
    //   hasRequest: !!this.dbhan.req,
    //   hasAuthHeader: !!this.dbhan.req?.headers?.authorization,
    //   headers: this.dbhan.req?.headers ? JSON.stringify(this.dbhan.req.headers, null, 2) : null
    // });

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
          // message = `${message} [loginUser: ${decoded.login}]`;
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

    // // Log final message with user info
    // logger.debug({
    //   message: message,
    //   hasUserInfo: hasUserInfo,
    //   loginUser: user
    // }, 'Analyser feedback - Final message');

    // Call parent feedback method with modified message
    // super.feedback({ ...obj, analysingMessage: message });
    //Remove the analysingMessage from the obj
    delete obj.analysingMessage;
    super.feedback(obj);

    // Force the logger.debug here with user info
    logger.debug({
      hasUserInfo: hasUserInfo,
      loginUser: user,
      ...extraObject
    }, message);
  }
}


module.exports = Analyser;
