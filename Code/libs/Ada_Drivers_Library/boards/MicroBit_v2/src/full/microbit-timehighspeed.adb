------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2016-2020, AdaCore                      --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------

with System.Machine_Code; use System.Machine_Code;
with nRF.Clock;

package body MicroBit.TimeHighspeed is
   package Clocks renames nRF.Clock;

   Clock_Us  : Time_Us := 0 with Volatile;

   procedure Initialize;

   ----------------
   -- Initialize --
   ----------------

   procedure Initialize is
   begin
      if not Clocks.High_Freq_Running then
         Clocks.Set_High_Freq_Source (Clocks.HFCLK_XTAL);
         Clocks.Start_High_Freq;
         loop
            exit when Clocks.High_Freq_Running;
         end loop;
      end if;
   end Initialize;

   --------------
   -- Delay_Us --
   --------------

   procedure Delay_Us (Microseconds : UInt64) is
   begin
      while Microseconds > Clock_Us loop

         --specific amount of NOPs for timing around 1 us
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);

         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);

         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);
         Asm (Template => "nop", Volatile => True);

         --Update_Clock; --using a function call takes more time than all the NOPs
         Clock_Us := Clock_Us + 1;
      end loop;
      Clock_Us := 0;
   end Delay_Us;
begin
   Initialize;
end MicroBit.TimeHighspeed;
