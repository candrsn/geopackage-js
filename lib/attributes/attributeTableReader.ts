/**
 * attributeTableReader module.
 * @module attributes/attributeTableReader
 */

import { UserTableReader } from '../user/userTableReader';
import { AttributeTable } from './attributeTable';
import { UserColumn } from '../user/userColumn';

/**
 * Reads the metadata from an existing attribute table
 * @class AttributeTableReader
 * @extends UserTableReader
 * @classdesc Reads the metadata from an existing attributes table
 */
export class AttributeTableReader extends UserTableReader {
  /**
   * @inheritdoc
   */
  createTable(tableName: string, columns: UserColumn[]): AttributeTable {
    return new AttributeTable(tableName, columns);
  }
}
