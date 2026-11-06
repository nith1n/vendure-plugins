import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * @description
 * An Akeneo category a ProductVariant is classified in, including the category's ancestors so
 * a parent category's Collection also contains its descendants' products. Read by the
 * `akeneo-category` CollectionFilter.
 */
@Entity()
@Index(['variantId', 'categoryCode'], { unique: true })
export class AkeneoVariantCategory extends VendureEntity {
    constructor(input?: DeepPartial<AkeneoVariantCategory>) {
        super(input);
    }

    @Index()
    @EntityId()
    variantId: ID;

    @Index()
    @Column({ type: 'varchar', length: 255 })
    categoryCode: string;
}
