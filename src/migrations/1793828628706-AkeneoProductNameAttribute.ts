import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoProductNameAttribute1793828628706 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "productNameAttribute" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "productNameAttribute"`, undefined);
   }

}
