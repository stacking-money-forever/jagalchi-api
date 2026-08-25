import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class FulfillTicketPurchaseDto {
  @IsIn(['apple', 'google'])
  store: 'apple' | 'google';

  @ValidateIf((value: FulfillTicketPurchaseDto) => value.store === 'apple')
  @IsString()
  @MinLength(100)
  @MaxLength(20_000)
  signedTransactionInfo?: string;

  @ValidateIf((value: FulfillTicketPurchaseDto) => value.store === 'google')
  @IsString()
  @MinLength(20)
  @MaxLength(4_096)
  purchaseToken?: string;
}
