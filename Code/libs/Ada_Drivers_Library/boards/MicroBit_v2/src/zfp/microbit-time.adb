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


with nRF.Clock;
with nRF.Device;        use nRF.Device;
with nRF.RTC;           use nRF.RTC;
with nRF.Events;
with nRF.Interrupts;
with System.Machine_Code; use System.Machine_Code;

package body MicroBit.Time is

   package Clocks renames nRF.Clock;

   Clock_Ms  : Time_Ms := 0 with Volatile;
   Period_Ms : constant Time_Ms := 1;

   Subscribers : array (1 .. 10) of Tick_Callback := (others => null);

   procedure Initialize;
   procedure Update_Clock;
   procedure RTC1_IRQHandler;

   ----------------
   -- Initialize --
   ----------------

   procedure Initialize is
   begin
      if not Clocks.Low_Freq_Running then
         Clocks.Set_Low_Freq_Source (Clocks.LFCLK_SYNTH);
         Clocks.Start_Low_Freq;
         loop
            exit when Clocks.Low_Freq_Running;
         end loop;
      end if;

      Stop (RTC_1);

      --  1kHz so 1 ms period ticks
      Set_Prescaler (RTC_1, 0);  -- prescaler is 0, runs at 32.768 Khz and has the best counter resolution (see Table 89 https://infocenter.nordicsemi.com/pdf/nRF52833_PS_v1.5.pdf)
      Set_Compare (RTC_1, 0,32); -- count to 33 -1 = 32 such that the the RTC runs close to 1 KHz. It seems the -1 term comes from 1 lost period due to stop, clear, start in the interrupt handler.
                                 -- but not exact, meaning it will differ from eg. an atomic wall clock! Exact is 33* 30.517us = 1007,061 us
                                 -- Error: 7 us per 1 Khz tick or 7ms per second or 420 ms per hour or 10.08 s per day.
      --
      Enable_Event (RTC_1, Compare_0_Event);

      nRF.Events.Enable_Interrupt (nRF.Events.RTC_1_COMPARE_0);

      nRF.Interrupts.Register (nRF.Interrupts.RTC1_Interrupt,
                              RTC1_IRQHandler'Access);

      nRF.Interrupts.Enable (nRF.Interrupts.RTC1_Interrupt);

      Start (RTC_1);
   end Initialize;

   ------------------
   -- Update_Clock --
   ------------------

   procedure Update_Clock is
   begin
      Clock_Ms := Clock_Ms + Period_Ms;
   end Update_Clock;

   ---------------------
   -- RTC1_IRQHandler --
   ---------------------

   procedure RTC1_IRQHandler is
   begin
      Stop (RTC_1);
      Clear (RTC_1); --note a clear takes between 15 and 45 us see manual, meaning there is limit to how fast you can restart
                     --another option is to use not use clear and update the CC with the period at every interrupt
                     --for this you need to read the counter value which takes 5 16MHz clock pulses + 2 LFCLK clock pulses, so also has a clear limit
                     --with this you can get 2 period signals eg 2*30.5us.
                     --to get to limit of 30.5us or 1 period signals , TICK needs to be enabled and event need to be raised
      Start (RTC_1);

      nRF.Events.Clear (nRF.Events.RTC_1_COMPARE_0);

      Update_Clock;

      for Subs of Subscribers loop

         if Subs /= null then
            --  Call the subscriber
            Subs.all;
         end if;

      end loop;
   end RTC1_IRQHandler;

   -----------
   -- Clock --
   -----------

   function Clock return Time_Ms is
   begin
      return Clock_Ms;
   end Clock;

   --------------
   -- Delay_Ms --
   --------------

   procedure Delay_Ms (Milliseconds : UInt64) is
      Wakeup_Time : constant UInt64 := Clock + Milliseconds;
   begin
      while Wakeup_Time > Clock loop
         -- Wait for interrupt, note that this is a blocking call as the CPU will halt all execution
         -- Using WFI saves power: https://developer.arm.com/documentation/ddi0406/b/System-Level-Architecture/The-System-Level-Programmers--Model/Exceptions/Wait-For-Interrupt?lang=en
         -- Disabling this
         Asm (Template => "wfi",
                Volatile => True);
      end loop;
   end Delay_Ms;

   -----------------
   -- Tick_Period --
   -----------------

   function Tick_Period return Time_Ms is
   begin
      return Period_Ms;
   end Tick_Period;

   --------------------
   -- Tick_Subscribe --
   --------------------

   function Tick_Subscriber (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = Callback then
            return True;
         end if;
      end loop;
      return False;
   end Tick_Subscriber;

   --------------------
   -- Tick_Subscribe --
   --------------------

   function Tick_Subscribe (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = null then
            Subs := Callback;
            return True;
         end if;
      end loop;

      return False;
   end Tick_Subscribe;

   ----------------------
   -- Tick_Unsubscribe --
   ----------------------

   function Tick_Unsubscribe (Callback : not null Tick_Callback) return Boolean is
   begin
      for Subs of Subscribers loop
         if Subs = Callback then
            Subs := null;
            return True;
         end if;
      end loop;
      return False;
   end Tick_Unsubscribe;

   ---------------
   -- HAL_Delay --
   ---------------

   Delay_Instance : aliased MB_Delays;

   function HAL_Delay return not null HAL.Time.Any_Delays is
   begin
      return Delay_Instance'Access;
   end HAL_Delay;

   ------------------------
   -- Delay_Microseconds --
   ------------------------

   overriding
   procedure Delay_Microseconds (This : in out MB_Delays;
                                 Us   : Integer)
   is
      pragma Unreferenced (This);
   begin
      Delay_Ms (UInt64 (Us / 1000));
   end Delay_Microseconds;

   ------------------------
   -- Delay_Milliseconds --
   ------------------------

   overriding
   procedure Delay_Milliseconds (This : in out MB_Delays;
                                 Ms   : Integer)
   is
      pragma Unreferenced (This);
   begin
      Delay_Ms (UInt64 (Ms));
   end Delay_Milliseconds;

   -------------------
   -- Delay_Seconds --
   -------------------

   overriding
   procedure Delay_Seconds (This : in out MB_Delays;
                            S    : Integer)
   is
      pragma Unreferenced (This);
   begin
      Delay_Ms (UInt64 (S * 1000));
   end Delay_Seconds;

begin
   Initialize;
end MicroBit.Time;
