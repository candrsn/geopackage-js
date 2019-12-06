
import GeoPackage from './geoPackage'
import GeoPackageConnection from './db/geoPackageConnection'
import DataColumnsDao from './dataColumns/dataColumnsDao'
import MediaTable from './extension/relatedTables/mediaTable'
import SimpleAttributesTable from './extension/relatedTables/simpleAttributesTable'
import FeatureDao from './features/user/featureDao'
import FeatureRow from './features/user/featureRow'
import RelationType from './extension/relatedTables/relationType'
import UserColumn from './user/userColumn'
import FeatureColumn from './features/user/featureColumn'
import SpatialReferenceSystem from './core/srs/spatialReferenceSystem'
import DataColumns from './dataColumns/dataColumns'
import DataTypes from './db/dataTypes'
import GeometryColumns from './features/columns/geometryColumns';

/* eslint-disable camelcase */
var wkx = require('wkx')
  , reproject = require('reproject')
  , path = require('path')
  , fs = require('fs')
  , geojsonvt = require('geojson-vt')
  , vtpbf = require('vt-pbf')
  , Pbf = require('pbf')
  , VectorTile = require('@mapbox/vector-tile')
  , pointToLineDistance = require('@turf/point-to-line-distance').default
  , polygonToLine = require('@turf/polygon-to-line').default
  , booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default
  , pointDistance = require('@turf/distance').default
  , helpers = require('@turf/helpers');

var GeoPackageValidate = require('./validate/geoPackageValidate')
  , GeoPackageTileRetriever = require('./tiles/retriever')
  , BoundingBox = require('./boundingBox')
  , GeometryData = require('./geom/geometryData')
  , TileBoundingBoxUtils = require('./tiles/tileBoundingBoxUtils')
  , FeatureTile = require('./tiles/features');

  type GeoPackageCallback = (err: Error, geopackage?: GeoPackage) => any;
/**
 * This module is the entry point to the GeoPackage API, providing static
 * methods for opening and building GeoPackage files.
 *
 * @exports api
 */
// var GeoPackageAPI = module.exports;

export default class GeoPackageAPI {
/**
 * In Node, open a GeoPackage file at the given path, or in a browser, load an
 * in-memory GeoPackage from the given byte array.
 * @param  {String|Uint8Array|Buffer} gppathOrByteArray path to the GeoPackage file or `Uint8Array` of GeoPackage bytes
 * @param  {GeoPackageCallback=} [callback] called with an `Error` if one occurred and the open `GeoPackage` object
 * @return {Promise<GeoPackage>} promise that resolves with the open {@link module:geoPackage~GeoPackage} object or rejects with an `Error`
 */
static open(gppathOrByteArray: string|Uint8Array|Buffer, callback?:GeoPackageCallback): Promise<GeoPackage> {
  return new Promise(function(resolve, reject) {
    var valid = (typeof gppathOrByteArray !== 'string') || (typeof gppathOrByteArray === 'string' &&
    (gppathOrByteArray.indexOf('http') === 0 || !GeoPackageValidate.validateGeoPackageExtension(gppathOrByteArray)));
    if (!valid) {
      reject(new Error('Invalid GeoPackage - Invalid GeoPackage Extension'));
    } else {
      resolve(gppathOrByteArray);
    }
  }).then(function() {
    return GeoPackageConnection.connect(gppathOrByteArray);
  }).then(function(connection) {
    if (gppathOrByteArray && typeof gppathOrByteArray === 'string') {
      return new GeoPackage(path.basename(gppathOrByteArray), gppathOrByteArray, connection);
    } else {
      return new GeoPackage('geopackage', undefined, connection);
    }
  }).then(function(geoPackage) {
    if (GeoPackageValidate.hasMinimumTables(geoPackage)) {
      return geoPackage;
    } else {
      throw new Error('Invalid GeoPackage - GeoPackage does not have the minimum required tables');
    }
  }).then(function(geoPackage) {
    if(callback) callback(null, geoPackage);
    return geoPackage;
  });
  // .catch(function(error){
  //   console.log('error', error);
  //   if(callback) {
  //     callback(error);
  //   } else {
  //     throw error;
  //   }
  // });
}

/**
 * In Node, create a GeoPackage file at the given file path, or in a browser,
 * create an in-memory GeoPackage.
 * @param  {String|geopackageCallback} gppath path of the created GeoPackage file; ignored in the browser
 * @param  {GeoPackageCallback} [callback] called with an `Error` if one occurred and the open {@link module:geoPackage~GeoPackage} object
 * @return {Promise<typeof GeoPackage>} promise that resolves with the open {@link module:geoPackage~GeoPackage} object or rejects with an  `Error`
 */
static create(gppath?: String | GeoPackageCallback, callback?: GeoPackageCallback): Promise<GeoPackage> {
  var realpath;
  if (typeof gppath === 'function') {
    callback = gppath;
    realpath = undefined;
  } else {
    realpath = gppath;
  }
  var valid = (typeof realpath !== 'string') || (typeof realpath === 'string' && !GeoPackageValidate.validateGeoPackageExtension(realpath));
  if (!valid) {
    if (callback) {
      return callback(new Error('Invalid GeoPackage'));
    }
    return Promise.reject(new Error('Invalid GeoPackage'));
  }

  var promise = new Promise(function(resolve) {
    if (typeof(process) !== 'undefined' && process.version && realpath) {
      fs.mkdirSync(path.dirname(realpath));
    }
    resolve(realpath);
  })
    .catch(function() {
    // could not create directory, just move on
    })
    .then(function() {
      return GeoPackageConnection.connect(realpath);
    })
    .then(function(connection) {
      connection.setApplicationId();
      return connection;
    })
    .then(function(connection) {
      if (realpath) {
        return new GeoPackage(path.basename(realpath), realpath, connection);
      } else {
        return new GeoPackage('geopackage', undefined, connection);
      }
    })
    .then(function(geopackage) {
      return geopackage.createRequiredTables();
    })
    .then(function(geopackage) {
      return geopackage.createSupportedExtensions();
    })
    .then(function(geopackage) {
      if (callback) callback(null, geopackage);
      return geopackage;
    })
    .catch(function(error){
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    });

  return promise;
}

/**
 * Create the [tables and rows](https://www.geopackage.org/spec121/index.html#tiles)
 * necessary to store tiles according to the ubiquitous [XYZ web/slippy-map tiles](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) scheme.
 * The extent for the [contents table]{@link module:core/contents~Contents} row,
 * `contentsBoundingBox`, is [informational only](https://www.geopackage.org/spec121/index.html#gpkg_contents_cols),
 * and need not match the [tile matrix set]{@link module:tiles/matrixset~TileMatrixSet}
 * extent, `tileMatrixSetBoundingBox`, which should be the precise bounding box
 * used to calculate the tile row and column coordinates of all tiles in the
 * tile set.  The two SRS ID parameters, `contentsSrsId` and `tileMatrixSetSrsId`,
 * must match, however.  See {@link module:tiles/matrixset~TileMatrixSet} for
 * more information about how GeoPackage consumers use the bouding boxes for a
 * tile set.
 *
 * @param {module:geoPackage~GeoPackage} geopackage the GeoPackage that will store the tiles
 * @param {string} tableName the name of the table that will store the tiles
 * @param {BoundingBox} contentsBoundingBox the bounds stored in the [`gpkg_contents`]{@link module:core/contents~Contents} table row for the tile matrix set
 * @param {SRSRef} contentsSrsId the ID of a [spatial reference system]{@link module:core/srs~SpatialReferenceSystem}; must match `tileMatrixSetSrsId`
 * @param {BoundingBox} tileMatrixSetBoundingBox the bounds stored in the [`gpkg_tile_matrix_set`]{@link module:tiles/matrixset~TileMatrixSet} table row
 * @param {SRSRef} tileMatrixSetSrsId the ID of a [spatial reference system]{@link module:core/srs~SpatialReferenceSystem}
 *   for the [tile matrix set](https://www.geopackage.org/spec121/index.html#_tile_matrix_set) table; must match `contentsSrsId`
 * @param {number} minZoom the zoom level of the lowest resolution [tile matrix]{@link module:tiles/matrix~TileMatrix} in the tile matrix set
 * @param {number} maxZoom the zoom level of the highest resolution [tile matrix]{@link module:tiles/matrix~TileMatrix} in the tile matrix set
 * @param {number=} tileSize the width and height in pixels of the tile images; defaults to 256
 * @returns {Promise} a `Promise` that resolves with the created {@link module:tiles/matrixset~TileMatrixSet} object, or rejects with an `Error`
 *
 * @todo make `tileMatrixSetSrsId` optional because it always has to be the same anyway
 */
static createStandardWebMercatorTileTable(geopackage, tableName, contentsBoundingBox, contentsSrsId, tileMatrixSetBoundingBox, tileMatrixSetSrsId, minZoom, maxZoom, tileSize) {
  tileSize = tileSize || 256;
  return geopackage.createTileTableWithTableName(tableName, contentsBoundingBox, contentsSrsId, tileMatrixSetBoundingBox, tileMatrixSetSrsId)
    .then(function(tileMatrixSet) {
      geopackage.createStandardWebMercatorTileMatrix(tileMatrixSetBoundingBox, tileMatrixSet, minZoom, maxZoom, tileSize);
      return tileMatrixSet;
    });
};

static createFeatureTable(geopackage, tableName, geometryColumn, featureColumns) {
  return GeoPackageAPI.createFeatureTableWithDataColumns(geopackage, tableName, geometryColumn, featureColumns, null);
};

static createFeatureTableWithDataColumns(geopackage, tableName, geometryColumn, featureColumns, dataColumns) {
  var boundingBox = new BoundingBox(-180, 180, -90, 90);
  return GeoPackageAPI.createFeatureTableWithDataColumnsAndBoundingBox(geopackage, tableName, geometryColumn, featureColumns, dataColumns, boundingBox, 4326);
};

static createFeatureTableWithDataColumnsAndBoundingBox(geopackage, tableName, geometryColumn, featureColumns, dataColumns, boundingBox, boundingBoxSrsId) {
  return geopackage.createFeatureTableWithGeometryColumnsAndDataColumns(geometryColumn, boundingBox, boundingBoxSrsId, featureColumns, dataColumns)
    .then(function() {
      return geopackage.getFeatureDao(tableName);
    });
};

/**
 * Create a feature table with the properties specified.
 * @param {module:geoPackage~GeoPackage} geopackage the geopackage object
 * @param {Object[]} properties properties to create columns from
 * @param {string} properties.name name of the column
 * @param {string} properties.dataType name of the data type
 * @return {Promise}
 */
static createFeatureTableWithProperties(geopackage, tableName, properties) {
  var geometryColumns = new GeometryColumns();
  geometryColumns.table_name = tableName;
  geometryColumns.column_name = 'geometry';
  geometryColumns.geometry_type_name = 'GEOMETRY';
  geometryColumns.z = 0;
  geometryColumns.m = 0;

  var boundingBox = new BoundingBox(-180, 180, -80, 80);

  var columns = [];
  var columnNumber = 0;
  columns.push(FeatureColumn.createPrimaryKeyColumnWithIndexAndName(columnNumber++, 'id'));
  columns.push(FeatureColumn.createGeometryColumn(columnNumber++, 'geometry', 'GEOMETRY', false, null));

  for (var i = 0; i < properties.length; i++) {
    var property = properties[i];
    columns.push(FeatureColumn.createColumnWithIndex(columnNumber++, property.name, DataTypes.fromName(property.dataType)));
  }

  return geopackage.createFeatureTableWithGeometryColumns(geometryColumns, boundingBox, 4326, columns);
};

/**
 * Create a feature table with the properties specified.
 * @param {module:geoPackage~GeoPackage} geopackage the geopackage object
 * @param {Object[]} properties properties to create columns from
 * @param {string} properties.name name of the column
 * @param {string} properties.dataType name of the data type
 * @param {DataColumns} [properties.dataColumn] data column for the property
 * @return {Promise}
 */
static createAttributeTableWithProperties(geopackage, tableName, properties) {
  var columns = [];
  var columnNumber = 0;
  columns.push(UserColumn.createPrimaryKeyColumnWithIndexAndName(columnNumber++, 'id'));

  var dataColumns = [];

  for (var i = 0; i < properties.length; i++) {
    var property = properties[i];
    columns.push(UserColumn.createColumnWithIndex(columnNumber++, property.name, DataTypes.fromName(property.dataType)));
    if (property.dataColumn) {
      var dc = new DataColumns();
      dc.table_name = property.dataColumn.table_name;
      dc.column_name = property.dataColumn.column_name;
      dc.name = property.dataColumn.name;
      dc.title = property.dataColumn.title;
      dc.description = property.dataColumn.description;
      dc.mime_type = property.dataColumn.mime_type;
      dc.constraint_name = property.dataColumn.constraint_name;
      dataColumns.push(dc);
    }
  }

  return geopackage.createAttributeTable(tableName, columns, dataColumns.length ? dataColumns : undefined);
};

static addAttributeRow(geopackage, tableName, row) {
  var attributeDao = geopackage.getAttributeDaoWithTableName(tableName);
  var attributeRow = attributeDao.newRow(row);
  return attributeDao.create(attributeRow);
};

/**
 * Create a simple attributes table with the properties specified.
 * @param {module:geoPackage~GeoPackage} geopackage the geopackage object
 * @param {Object[]} properties properties to create columns from
 * @param {string} properties.name name of the column
 * @param {string} properties.dataType name of the data type
 * @return {Promise}
 */
static createSimpleAttributesTableWithProperties(geopackage, tableName, properties) {
  var relatedTables = geopackage.getRelatedTablesExtension();
  var columns = [];
  var columnNumber = SimpleAttributesTable.numRequiredColumns();
  if (properties) {
    for (var i = 0; i < properties.length; i++) {
      var property = properties[i];
      columns.push(UserColumn.createColumnWithIndex(columnNumber++, property.name, DataTypes.fromName(property.dataType), true));
    }
  }
  var simpleAttributesTable = SimpleAttributesTable.create(tableName, columns);
  relatedTables.createRelatedTable(simpleAttributesTable);
  return relatedTables.getSimpleAttributesDao(simpleAttributesTable);
};

/**
 * Create a media table with the properties specified.  These properties are added to the required columns
 * @param {module:geoPackage~GeoPackage} geopackage the geopackage object
 * @param {Object[]} properties properties to create columns from
 * @param {string} properties.name name of the column
 * @param {string} properties.dataType name of the data type
 * @return {Promise}
 */
static createMediaTableWithProperties(geopackage, tableName, properties) {
  var relatedTables = geopackage.getRelatedTablesExtension();
  var columns = [];
  var columnNumber = MediaTable.numRequiredColumns();
  if (properties) {
    for (var i = 0; i < properties.length; i++) {
      var property = properties[i];
      columns.push(UserColumn.createColumnWithIndex(columnNumber++, property.name, DataTypes.fromName(property.dataType)));
    }
  }
  var mediaTable = MediaTable.create(tableName, columns);
  relatedTables.createRelatedTable(mediaTable);
  return relatedTables.getMediaDao(mediaTable);
};

static addMedia(geopackage: GeoPackage, tableName: String, dataBuffer: Buffer, contentType: String, additionalProperties?: {}) {
  var relatedTables = geopackage.getRelatedTablesExtension();
  var mediaDao = relatedTables.getMediaDao(tableName);
  var row = mediaDao.newRow();
  row.setContentType(contentType);
  row.setData(dataBuffer);
  for (var key in additionalProperties) {
    row.setValueWithColumnName(key, additionalProperties[key]);
  }
  return mediaDao.create(row);
};

static linkMedia(geopackage, baseTableName, baseId, mediaTableName, mediaId) {
  var relatedTables = geopackage.getRelatedTablesExtension();
  return relatedTables.linkRelatedIds(baseTableName, baseId, mediaTableName, mediaId, RelationType.MEDIA);
};

static getLinkedMedia(geopackage, baseTableName, baseId) {
  var relationships = GeoPackageAPI.getRelatedRows(geopackage, baseTableName, baseId);
  var mediaRelationships = [];
  for (var i = 0; i < relationships.length; i++) {
    var relationship = relationships[i];
    if (relationship.relation_name === RelationType.MEDIA.name) {
      for (var r = 0; r < relationship.mappingRows.length; r++) {
        var row = relationship.mappingRows[r].row;
        mediaRelationships.push(row);
      }
    }
  }

  return mediaRelationships;
};

static getRelatedRows(geopackage, baseTableName, baseId) {
  return geopackage.getRelatedTablesExtension().getRelatedRows(baseTableName, baseId);
};

/**
 * Adds a GeoJSON feature to the GeoPackage
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {object}   feature    GeoJSON feature to add
 * @param  {String}   tableName  name of the table that will store the feature
 */
static addGeoJSONFeatureToGeoPackage(geopackage, feature, tableName) {
  var featureDao = geopackage.getFeatureDao(tableName);
  var srs = featureDao.getSrs();
  var featureRow = featureDao.newRow();
  var geometryData = new GeometryData();
  geometryData.setSrsId(srs.srs_id);
  if (!(srs.organization === 'EPSG' && srs.organization_coordsys_id === 4326)) {
    feature = reproject.reproject(feature, 'EPSG:4326', featureDao.projection);
  }

  var featureGeometry = typeof feature.geometry === 'string' ? JSON.parse(feature.geometry) : feature.geometry;
  var geometry = wkx.Geometry.parseGeoJSON(featureGeometry);
  geometryData.setGeometry(geometry);
  featureRow.setGeometry(geometryData);
  for (var propertyKey in feature.properties) {
    if (Object.prototype.hasOwnProperty.call(feature.properties, propertyKey)) {
      featureRow.setValueWithColumnName(propertyKey, feature.properties[propertyKey]);
    }
  }

  return featureDao.create(featureRow);
};

/**
 * Adds a GeoJSON feature to the GeoPackage and updates the FeatureTableIndex extension if it exists
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {object}   feature    GeoJSON feature to add
 * @param  {String}   tableName  name of the table that will store the feature
 */
static addGeoJSONFeatureToGeoPackageAndIndex(geopackage, feature, tableName) {
  var featureDao = geopackage.getFeatureDao(tableName);
  if (!featureDao) throw new Error('No feature Dao for table '+ tableName);
  var srs = featureDao.getSrs();
  var featureRow = featureDao.newRow();
  var geometryData = new GeometryData();
  geometryData.setSrsId(srs.srs_id);

  var reprojectedFeature = reproject.reproject(feature, 'EPSG:4326', featureDao.projection);

  var featureGeometry = typeof reprojectedFeature.geometry === 'string' ? JSON.parse(reprojectedFeature.geometry) : reprojectedFeature.geometry;
  var geometry = wkx.Geometry.parseGeoJSON(featureGeometry);
  geometryData.setGeometry(geometry);
  featureRow.setGeometry(geometryData);
  for (var propertyKey in feature.properties) {
    if (Object.prototype.hasOwnProperty.call(feature.properties, propertyKey)) {
      featureRow.setValueWithColumnName(propertyKey, feature.properties[propertyKey]);
    }
  }

  var id = featureDao.create(featureRow);
  var fti = featureDao.featureTableIndex;
  var tableIndex = fti.getTableIndex();
  if (!tableIndex) return id;
  fti.indexRow(tableIndex, id, geometryData);
  fti.updateLastIndexed(tableIndex);
  return id;
};

/**
 * Queries for GeoJSON features in a feature tables
 * @param  {String}   geoPackagePath  path to the GeoPackage file
 * @param  {String}   tableName   Table name to query
 * @param  {BoundingBox}   boundingBox BoundingBox to query
 */
static queryForGeoJSONFeaturesInTableFromPath(geoPackagePath, tableName, boundingBox) {
  return GeoPackageAPI.open(geoPackagePath)
    .then(function(geoPackage: GeoPackage) {
      var features = geoPackage.queryForGeoJSONFeaturesInTable(tableName, boundingBox);
      geoPackage.close();
      return features;
    });
};

/**
 * Queries for GeoJSON features in a feature tables
 * @param  {module:geoPackage~GeoPackage}   geoPackage  open GeoPackage object
 * @param  {String}   tableName   Table name to query
 * @param  {BoundingBox}   boundingBox BoundingBox to query
 */
static queryForGeoJSONFeaturesInTable(geoPackage, tableName, boundingBox) {
  return geoPackage.queryForGeoJSONFeaturesInTable(tableName, boundingBox);
};

/**
 * Iterates GeoJSON features in a feature table that matches the bounding box
 * @param  {module:geoPackage~GeoPackage}   geoPackage  open GeoPackage object
 * @param  {String}   tableName   Table name to query
 * @param  {BoundingBox}   boundingBox BoundingBox to query
 */
static iterateGeoJSONFeaturesInTableWithinBoundingBox(geoPackage, tableName, boundingBox) {
  return geoPackage.iterateGeoJSONFeaturesInTableWithinBoundingBox(tableName, boundingBox);
};


/**
 * Iterates GeoJSON features in a feature table that matches the bounding box
 * @param  {String}   geoPackagePath  path to the GeoPackage file
 * @param  {String}   tableName   Table name to query
 * @param  {BoundingBox}   boundingBox BoundingBox to query
 */
static iterateGeoJSONFeaturesFromPathInTableWithinBoundingBox(geoPackagePath, tableName, boundingBox) {
  return GeoPackageAPI.open(geoPackagePath)
    .then(function(geoPackage: GeoPackage) {
      return geoPackage.iterateGeoJSONFeaturesInTableWithinBoundingBox(tableName, boundingBox);
    });
};

static createDataColumnMap(featureDao) {
  var columnMap = {};
  var dcd = new DataColumnsDao(featureDao.geoPackage);
  featureDao.table.columns.forEach(function(column) {
    var dataColumn = dcd.getDataColumns(featureDao.table.table_name, column.name);
    columnMap[column.name] = {
      index: column.index,
      name: column.name,
      max: column.max,
      min: column.min,
      notNull: column.notNull,
      primaryKey: column.primaryKey,
      dataType: column.dataType ? DataTypes.nameFromType(column.dataType) : '',
      displayName: dataColumn && dataColumn.name ? dataColumn.name : column.name,
      dataColumn: dataColumn
    };
  }.bind(this));
  return columnMap;
};

/**
 * @typedef {Object} GeoJSONFeatureIterator
 * @property {SpatialReferenceSystem} srs SRS of the iterator
 * @property {FeatureDao} featureDao featureDao of the iterator objects
 * @property {IterableIterator<FeatureRow>} results iterator of results
 */

/**
 * Iterate GeoJSON features from table
 * @param  {module:geoPackage~GeoPackage} geopackage      open GeoPackage object
 * @param  {String} table           Table name to Iterate
 * @return {GeoJSONFeatureIterator}
 */
static iterateGeoJSONFeaturesFromTable(geopackage, table) {
  var featureDao = geopackage.getFeatureDao(table);
  if (!featureDao) {
    throw new Error('No Table exists with the name ' + table);
  }

  var columnMap = GeoPackageAPI.createDataColumnMap(featureDao);

  var srs = featureDao.getSrs();

  var iterator = featureDao.queryForEach();

  return {
    srs: srs,
    featureDao: featureDao,
    results: {
      [Symbol.iterator]() {
        return this;
      },
      next: function() {
        var nextRow = iterator.next();
        if (!nextRow.done) {
          var featureRow;
          var geometry;

          while(!nextRow.done && !geometry) {
            featureRow = featureDao.getRow(nextRow.value);
            return {
              value: GeoPackageAPI.parseFeatureRowIntoGeoJSON(featureRow, srs, columnMap),
              done: false
            };
          }
        }
        return {
          value: undefined,
          done: true
        };
      }.bind(this)
    }
  };
};

/**
 * Gets a GeoJSON feature from the table by id
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the table to get the feature from
 * @param  {Number}   featureId  ID of the feature
 */
static getFeature(geopackage, table, featureId) {
  var srs;
  var featureDao = geopackage.getFeatureDao(table);
  srs = featureDao.getSrs();
  var feature = featureDao.queryForId(featureId);
  if (!feature) {
    var features = featureDao.queryForAllEq('_feature_id', featureId);
    if (features.length) {
      feature = featureDao.getRow(features[0]);
    } else {
      features = featureDao.queryForAllEq('_properties_id', featureId);
      if (features.length) {
        feature = featureDao.getRow(features[0]);
      }
    }
  }
  if (feature) {
    return GeoPackageAPI.parseFeatureRowIntoGeoJSON(feature, srs);
  }
};

// eslint-disable-next-line complexity
static parseFeatureRowIntoGeoJSON(featureRow: FeatureRow, srs: SpatialReferenceSystem, columnMap?: any) {
  var geoJson = {
    type: 'Feature',
    properties: {},
    id: undefined,
    geometry: undefined
  };
  var geometry = featureRow.getGeometry();
  if (geometry && geometry.geometry) {
    var geoJsonGeom = geometry.geometry.toGeoJSON();
    if (srs.definition && srs.definition !== 'undefined' && (srs.organization.toUpperCase() + ':' + srs.organization_coordsys_id) !== 'EPSG:4326') {
      // geoJsonGeom = reproject.reproject(geoJsonGeom, srs.organization.toUpperCase() + ':' + srs.organization_coordsys_id, 'EPSG:4326');
      geoJsonGeom = reproject.reproject(geoJsonGeom, srs.getProjection(), 'EPSG:4326');

    }
    geoJson.geometry = geoJsonGeom;
  }

  for (var key in featureRow.values) {
    if(Object.prototype.hasOwnProperty.call(featureRow.values, key) && key !== featureRow.getGeometryColumn().name && key !== 'id') {
      if (key.toLowerCase() === '_feature_id') {
        geoJson.id = featureRow.values[key];
      } else if (key.toLowerCase() === '_properties_id') {
        geoJson.properties[key.substring(12)] = featureRow.values[key];
      } else if (columnMap && columnMap[key]) {
        geoJson.properties[columnMap[key].displayName] = featureRow.values[key];
      } else {
        geoJson.properties[key] = featureRow.values[key];
      }
    } else if (featureRow.getGeometryColumn().name === key) {
      // geoJson.properties[key] = geometry && !geometry.geometryError ? 'Valid' : geometry.geometryError;
    }
  }
  geoJson.id = geoJson.id || featureRow.getId();
  return geoJson;
};


/**
 * Gets a tile from the specified table
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the table to get the tile from
 * @param  {Number}   zoom       zoom level of the tile
 * @param  {Number}   tileRow    row of the tile
 * @param  {Number}   tileColumn column of the tile
 *
 * @todo jsdoc return value
 */
static getTileFromTable(geopackage, table, zoom, tileRow, tileColumn) {
  var tileDao = geopackage.getTileDao(table);
  return tileDao.queryForTile(tileColumn, tileRow, zoom);
};

/**
 * Gets the tiles in the EPSG:4326 bounding box
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the tile table
 * @param  {Number}   zoom       Zoom of the tiles to query for
 * @param  {Number}   west       EPSG:4326 western boundary
 * @param  {Number}   east       EPSG:4326 eastern boundary
 * @param  {Number}   south      EPSG:4326 southern boundary
 * @param  {Number}   north      EPSG:4326 northern boundary
 */
static getTilesInBoundingBox(geopackage, table, zoom, west, east, south, north) {
  var tiles = {
    columns: [],
    srs: undefined,
    tiles: [],
    west: undefined,
    east: undefined,
    south: undefined,
    north: undefined,
    zoom: undefined
  };

  var tileDao = geopackage.getTileDao(table);
  if (zoom < tileDao.minZoom || zoom > tileDao.maxZoom) {
    return;
  }
  for (var i = 0; i < tileDao.table.columns.length; i++) {
    var column = tileDao.table.columns[i];
    tiles.columns.push({
      index: column.index,
      name: column.name,
      max: column.max,
      min: column.min,
      notNull: column.notNull,
      primaryKey: column.primaryKey
    });
  }
  var srs = tileDao.getSrs();
  tiles.srs = srs;
  tiles.tiles = [];

  var tms = tileDao.tileMatrixSet;
  var tm = tileDao.getTileMatrixWithZoomLevel(zoom);
  if (!tm) {
    return tiles;
  }
  var mapBoundingBox = new BoundingBox(Math.max(-180, west), Math.min(east, 180), south, north);
  tiles.west = Math.max(-180, west).toFixed(2);
  tiles.east = Math.min(east, 180).toFixed(2);
  tiles.south = south.toFixed(2);
  tiles.north = north.toFixed(2);
  tiles.zoom = zoom;
  mapBoundingBox = mapBoundingBox.projectBoundingBox('EPSG:4326', tileDao.srs.organization.toUpperCase() + ':' + tileDao.srs.organization_coordsys_id);

  var grid = TileBoundingBoxUtils.getTileGridWithTotalBoundingBox(tms.getBoundingBox(), tm.matrix_width, tm.matrix_height, mapBoundingBox);

  var iterator = tileDao.queryByTileGrid(grid, zoom);

  for (var row of iterator ) {
    var tile = {} as any;
    tile.tableName = table;
    tile.id = row.getId();

    var tileBB = TileBoundingBoxUtils.getTileBoundingBox(tms.getBoundingBox(), tm, row.getTileColumn(), row.getRow());
    tile.minLongitude = tileBB.minLongitude;
    tile.maxLongitude = tileBB.maxLongitude;
    tile.minLatitude = tileBB.minLatitude;
    tile.maxLatitude = tileBB.maxLatitude;
    tile.projection = tileDao.srs.organization.toUpperCase() + ':' + tileDao.srs.organization_coordsys_id;
    tile.values = [];
    for (i = 0; i < tiles.columns.length; i++) {
      var value = row.values[tiles.columns[i].name];
      if (tiles.columns[i].name === 'tile_data') {
        tile.values.push('data');
      } else
      if (value === null || value === 'null') {
        tile.values.push('');
      } else {
        tile.values.push(value.toString());
        tile[tiles.columns[i].name] = value;
      }
    }
    tiles.tiles.push(tile);
  }
  return tiles;
};

/**
 * Gets the tiles in the EPSG:4326 bounding box
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the tile table
 * @param  {Number}   webZoom       Zoom of the tiles to query for
 * @param  {Number}   west       EPSG:4326 western boundary
 * @param  {Number}   east       EPSG:4326 eastern boundary
 * @param  {Number}   south      EPSG:4326 southern boundary
 * @param  {Number}   north      EPSG:4326 northern boundary
 */
static getTilesInBoundingBoxWebZoom(geopackage, table, webZoom, west, east, south, north) {
  var tiles = {
    columns: [],
    srs: SpatialReferenceSystem,
    tiles: [],
    west: undefined,
    east: undefined,
    south: undefined,
    north: undefined,
    zoom: Number
  };

  var tileDao = geopackage.getTileDao(table);
  if (webZoom < tileDao.minWebZoom || webZoom > tileDao.maxWebZoom) {
    return;
  }
  tiles.columns = [];
  for (var i = 0; i < tileDao.table.columns.length; i++) {
    var column = tileDao.table.columns[i];
    tiles.columns.push({
      index: column.index,
      name: column.name,
      max: column.max,
      min: column.min,
      notNull: column.notNull,
      primaryKey: column.primaryKey
    });
  }
  var srs = tileDao.getSrs();
  tiles.srs = srs;
  tiles.tiles = [];

  var zoom = tileDao.webZoomToGeoPackageZoom(webZoom);

  var tms = tileDao.tileMatrixSet;
  var tm = tileDao.getTileMatrixWithZoomLevel(zoom);
  if (!tm) {
    return tiles;
  }
  var mapBoundingBox = new BoundingBox(Math.max(-180, west), Math.min(east, 180), south, north);
  tiles.west = Math.max(-180, west).toFixed(2);
  tiles.east = Math.min(east, 180).toFixed(2);
  tiles.south = south.toFixed(2);
  tiles.north = north.toFixed(2);
  tiles.zoom = zoom;
  mapBoundingBox = mapBoundingBox.projectBoundingBox('EPSG:4326', tileDao.srs.organization.toUpperCase() + ':' + tileDao.srs.organization_coordsys_id);

  var grid = TileBoundingBoxUtils.getTileGridWithTotalBoundingBox(tms.getBoundingBox(), tm.matrix_width, tm.matrix_height, mapBoundingBox);

  var iterator = tileDao.queryByTileGrid(grid, zoom);
  for (var row of iterator) {
    var tile = {
      tableName: String,
      id: undefined,
      minLongitude: Number,
      maxLongitude: Number,
      minLatitude: Number,
      maxLatitude: Number,
      projection: undefined as String,
      values: []
    };
    tile.tableName = table;
    tile.id = row.getId();

    var tileBB = TileBoundingBoxUtils.getTileBoundingBox(tms.getBoundingBox(), tm, row.getTileColumn(), row.getRow());
    tile.minLongitude = tileBB.minLongitude;
    tile.maxLongitude = tileBB.maxLongitude;
    tile.minLatitude = tileBB.minLatitude;
    tile.maxLatitude = tileBB.maxLatitude;
    tile.projection = tileDao.srs.organization.toUpperCase() + ':' + tileDao.srs.organization_coordsys_id;
    tile.values = [];
    for (i = 0; i < tiles.columns.length; i++) {
      var value = row.values[tiles.columns[i].name];
      if (tiles.columns[i].name === 'tile_data') {
        tile.values.push('data');
      } else
      if (value === null || value === 'null') {
        tile.values.push('');
      } else {
        tile.values.push(value.toString());
        tile[tiles.columns[i].name] = value;
      }
    }
    tiles.tiles.push(tile);
  }
  return tiles;
};

static getFeatureTileFromXYZ(geopackage, table, x, y, z, width, height) {
  x = Number(x);
  y = Number(y);
  z = Number(z);
  width = Number(width);
  height = Number(height);
  var featureDao = geopackage.getFeatureDao(table);
  if (!featureDao) return;
  var ft = new FeatureTile(featureDao, width, height);
  return ft.drawTile(x, y, z);
};

// eslint-disable-next-line complexity
static getClosestFeatureInXYZTile(geopackage, table, x, y, z, latitude, longitude) {
  x = Number(x);
  y = Number(y);
  z = Number(z);

  var featureDao = geopackage.getFeatureDao(table);
  if (!featureDao) return;
  var ft = new FeatureTile(featureDao, 256, 256);
  var tileCount = ft.getFeatureCountXYZ(x, y, z);
  var boundingBox = TileBoundingBoxUtils.getWebMercatorBoundingBoxFromXYZ(x, y, z);
  boundingBox = boundingBox.projectBoundingBox('EPSG:3857', 'EPSG:4326');

  if (tileCount > 10000) {
    // too many, send back the entire tile
    // add the goepackage name and table
    var gj = boundingBox.toGeoJSON();
    gj.feature_count = tileCount;
    gj.coverage = true;
    gj.gp_table = table;
    gj.gp_name = geopackage.name;
    return gj;
  }
  var ne = [boundingBox.maxLongitude, boundingBox.maxLatitude];
  var sw = [boundingBox.minLongitude, boundingBox.minLatitude];
  var width = (ne[0] - sw[0]);
  var widthPerPixel = width / 256;
  var tolerance = 10 * widthPerPixel;
  boundingBox.maxLongitude = longitude + tolerance;
  boundingBox.minLongitude = longitude - tolerance;
  boundingBox.maxLatitude = latitude + tolerance;
  boundingBox.minLatitude = latitude - tolerance;
  var iterator = featureDao.queryForGeoJSONIndexedFeaturesWithBoundingBox(boundingBox);
  var features = [];
  var closestDistance = 100000000000;
  var closest;

  var centerPoint = helpers.point([ longitude, latitude ]);

  for (var feature of iterator) {
    feature.type = "Feature";
    var geometry = feature.geometry;

    if (geometry.type === 'Point') {
      var distance = pointDistance(centerPoint, geometry);
      if (distance < closestDistance) {
        closest = feature;
        closestDistance = distance;
      } else if (distance === closestDistance && closest.type !== 'Point') {
        closest = feature;
        closestDistance = distance;
      }
    } else if (geometry.type === 'LineString') {
      distance = pointToLineDistance(centerPoint, geometry);
      if (distance < closestDistance) {
        closest = feature;
        closestDistance = distance;
      } else if (distance === closestDistance && closest.type !== 'Point') {
        closest = feature;
        closestDistance = distance;
      }
    } else if (geometry.type === 'MultiLineString') { 
      geometry.coordinates.forEach(function(lineString) {
        var distance = pointToLineDistance(centerPoint, lineString);
        if (distance < closestDistance) {
          closest = feature;
          closestDistance = distance;
        }
      });
    } 
    else if (geometry.type === 'Polygon') {
      if (booleanPointInPolygon(centerPoint, geometry)) {
        if (closestDistance !== 0) {
          closest = feature;
          closestDistance = 0;
        }
      } else {
        var line = polygonToLine(geometry);
        // @ts-ignore
        if (line.geometry.type === 'LineString') {
          // @ts-ignore
          distance = pointToLineDistance(centerPoint, line);
          if (distance < closestDistance) {
            closest = feature;
            closestDistance = distance;
          }
        // @ts-ignore
        } else if (line.geometry.type === 'MultiLineString') {
          // @ts-ignore
          line.geometry.coordinates.forEach(function(lineString) {
            var distance = pointToLineDistance(centerPoint, lineString);
            if (distance < closestDistance) {
              closest = feature;
              closestDistance = distance;
            }
          });
        }
      }
    }
    else if (geometry.type === 'MultiPolygon') {
      if (booleanPointInPolygon(centerPoint, geometry)) {
        if (closestDistance !== 0) {
          closest = feature;
          closestDistance = 0;
        }
      } else {
        line = polygonToLine(geometry);
        if (line.type === 'FeatureCollection') {
          line.features.forEach(function(line) {
            if (line.geometry.type === 'LineString') {
              // @ts-ignore
              distance = pointToLineDistance(centerPoint, line);
              if (distance < closestDistance) {
                closest = feature;
                closestDistance = distance;
              }
            } else if (line.geometry.type === 'MultiLineString') {
              line.geometry.coordinates.forEach(function(lineString) {
                // @ts-ignore
                distance = pointToLineDistance(centerPoint, lineString);
                if (distance < closestDistance) {
                  closest = feature;
                  closestDistance = distance;
                }
              });
            }
          });
        } else {
          if (line.geometry.type === 'LineString') {
            // @ts-ignore
            distance = pointToLineDistance(centerPoint, line);
            if (distance < closestDistance) {
              closest = feature;
              closestDistance = distance;
            }
          } else if (line.geometry.type === 'MultiLineString') {
            line.geometry.coordinates.forEach(function(lineString) {
              // @ts-ignore
              distance = pointToLineDistance(centerPoint, lineString);
              if (distance < closestDistance) {
                closest = feature;
                closestDistance = distance;
              }
            });
          }
        }
      }
    }
    features.push(feature);
  }
  if (closest) {
    closest.gp_table = table;
    closest.gp_name = geopackage.name;
    closest.distance = closestDistance;
  }
  return closest;
};
/**
 * Gets the features in the EPSG:3857 tile
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the feature table
 * @param  {Number}   x       x tile number
 * @param  {Number}   y       y tile number
 * @param  {Number}   z      z tile number
 * @param  {Boolean}   [skipVerification]      skip the extra verification to determine if the feature really is within the tile
 */
static getGeoJSONFeaturesInTile(geopackage, table, x, y, z, skipVerification?: Boolean) {
  var webMercatorBoundingBox = TileBoundingBoxUtils.getWebMercatorBoundingBoxFromXYZ(x, y, z);
  var bb = webMercatorBoundingBox.projectBoundingBox('EPSG:3857', 'EPSG:4326');
  return geopackage.indexFeatureTable(table)
    .then(function() {
      return geopackage.getFeatureDao(table);
    })
    .then(function(featureDao) {
      if (!featureDao) return;
      var features = [];
      var iterator = featureDao.queryForGeoJSONIndexedFeaturesWithBoundingBox(bb, skipVerification);
      for (var feature of iterator) {
        features.push(feature);
      }
      return features;
    })
    .catch(function(error) {
      console.log('error', error);
    });
};

static convertPBFToVectorTile(pbf) {
  return new VectorTile.VectorTile(new Pbf(pbf));
};

/**
 * Gets a mapbox VectorTile for the x y z web mercator tile specified
 * @param  {module:geoPackage~GeoPackage} geopackage open GeoPackage object
 * @param  {String} table      table name
 * @param  {Number} x          x tile
 * @param  {Number} y          y tile
 * @param  {Number} z          web zoom
 * @return {typeof VectorTile}
 */
static getVectorTile(geopackage, table, x, y, z) {
  return GeoPackageAPI.getVectorTileProtobuf(geopackage, table, x, y, z)
    .then(function(pbf) {
      return new VectorTile.VectorTile(new Pbf(pbf));
    });
};

/**
 * Gets a protobuf for the x y z web mercator tile specified
 * @param  {module:geoPackage~GeoPackage} geopackage open GeoPackage object
 * @param  {String} table      table name
 * @param  {Number} x          x tile
 * @param  {Number} y          y tile
 * @param  {Number} z          web zoom
 * @return {any}
 */
static getVectorTileProtobuf(geopackage, table, x, y, z) {
  return GeoPackageAPI.getGeoJSONFeaturesInTile(geopackage, table, x, y, z, true)
    .then(function(features) {
      var featureCollection = {
        type: 'FeatureCollection',
        features: features
      };
      var tileBuffer = 8;
      var tileIndex = geojsonvt(featureCollection, {buffer: tileBuffer * 8, maxZoom: z});
      var tile = tileIndex.getTile(z, x, y);

      var gjvt = {};

      if (tile) {
        gjvt[table] = tile;
      } else {
        gjvt[table] = {features:[]};
      }

      return vtpbf.fromGeojsonVt(gjvt);
    });
};

/**
 * Gets the features in the EPSG:4326 bounding box
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the feature table
 * @param  {Number}   west       EPSG:4326 western boundary
 * @param  {Number}   east       EPSG:4326 eastern boundary
 * @param  {Number}   south      EPSG:4326 southern boundary
 * @param  {Number}   north      EPSG:4326 northern boundary
 */
static getFeaturesInBoundingBox(geopackage, table, west, east, south, north) {
  return geopackage.indexFeatureTable(table)
    .then(function() {
      var featureDao = geopackage.getFeatureDao(table);
      if (!featureDao) throw new Error('Unable to find table ' + table);
      var bb = new BoundingBox(west, east, south, north);
      var iterator = featureDao.queryIndexedFeaturesWithBoundingBox(bb);
      return iterator;
    });
};

/**
 * Gets a tile image for an XYZ tile pyramid location
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the table containing the tiles
 * @param  {Number}   x          x index of the tile
 * @param  {Number}   y          y index of the tile
 * @param  {Number}   z          zoom level of the tile
 * @param  {Number}   width      width of the resulting tile
 * @param  {Number}   height     height of the resulting tile
 * @return {Promise}
 */
static getTileFromXYZ(geopackage, table, x, y, z, width, height) {
  x = Number(x);
  y = Number(y);
  z = Number(z);
  width = Number(width);
  height = Number(height);
  var tileDao = geopackage.getTileDao(table);
  var retriever = new GeoPackageTileRetriever(tileDao, width, height);
  return retriever.getTile(x, y, z);
};

/**
 * Draws an XYZ tile pyramid location into the provided canvas
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the table containing the tiles
 * @param  {Number}   x          x index of the tile
 * @param  {Number}   y          y index of the tile
 * @param  {Number}   z          zoom level of the tile
 * @param  {Number}   width      width of the resulting tile
 * @param  {Number}   height     height of the resulting tile
 * @param  {any}   canvas     canvas element to draw the tile into
 */
static drawXYZTileInCanvas(geopackage, table, x, y, z, width, height, canvas) {
  x = Number(x);
  y = Number(y);
  z = Number(z);
  width = Number(width);
  height = Number(height);
  var tileDao = geopackage.getTileDao(table);
  var retriever = new GeoPackageTileRetriever(tileDao, width, height);
  return retriever.drawTileIn(x, y, z, canvas);
};

/**
 * Draws a tile specified by the bounds in EPSG:4326 into the canvas
 * @param  {module:geoPackage~GeoPackage}   geopackage open GeoPackage object
 * @param  {String}   table      name of the table containing the tiles
 * @param  {Number}   minLat     minimum latitude bounds of tile
 * @param  {Number}   minLon     minimum longitude bounds of tile
 * @param  {Number}   maxLat     maximum latitude bounds of tile
 * @param  {Number}   maxLon     maximum longitude bounds of tile
 * @param  {Number}   z          zoom level of the tile
 * @param  {Number}   width      width of the resulting tile
 * @param  {Number}   height     height of the resulting tile
 * @param  {any}   canvas     canvas element to draw the tile into
 */
static draw4326TileInCanvas(geopackage, table, minLat, minLon, maxLat, maxLon, z, width, height, canvas) {
  z = Number(z);
  width = Number(width);
  height = Number(height);
  var tileDao = geopackage.getTileDao(table);
  var retriever = new GeoPackageTileRetriever(tileDao, width, height);
  var bounds = new BoundingBox(minLon, maxLon, minLat, maxLat);
  return retriever.getTileWithWgs84BoundsInProjection(bounds, z, 'EPSG:4326', canvas);
};

}
///////////////////
// JSDoc Globals //
///////////////////

/**
 * @callback geopackageCallback
 * @param {?Error} error
 * @param {module:geoPackage~GeoPackage=} [geopackage] a GeoPackage instance
 */

/**
  * An integer database key referencing a {@link module:core/srs~SpatialReferenceSystem} row in a GeoPackage database
  * @typedef {number} SRSRef
  * @see https://www.geopackage.org/spec121/index.html#spatial_ref_sys
  */
