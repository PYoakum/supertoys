import { randomUUID } from "crypto";

// uuid4
export function generateUUID():string{
    return randomUUID();
}