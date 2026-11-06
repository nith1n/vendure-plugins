import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoProductSyncChanges1793961037264 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "productSyncedFrom" TIMESTAMP`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "productSyncFingerprint" character varying(64)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "productSyncFingerprint"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "productSyncedFrom"`, undefined);
   }

}
