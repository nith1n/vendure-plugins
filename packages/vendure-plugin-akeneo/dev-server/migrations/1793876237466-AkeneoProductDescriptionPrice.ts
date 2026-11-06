import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoProductDescriptionPrice1793876237466 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "productDescriptionAttribute" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "productPriceAttribute" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "productPriceAttribute"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "productDescriptionAttribute"`, undefined);
   }

}
