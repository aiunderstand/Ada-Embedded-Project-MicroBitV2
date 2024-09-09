with Ada.Interrupts.Names;
with HAL;      use HAL;
--with HAL.Time;
with System; use System;
package MicroBit.TimeWithRTC1 is
   subtype Time_Ms is UInt64;
   type Tick_Callback is access procedure;
   Subscribers : array (1 .. 10) of Tick_Callback := (others => null);

   procedure Delay_Ms (Ms : Integer);

   procedure Sleep (Ms : Integer) renames Delay_Ms;

--  function HAL_Delay return not null HAL.Time.Any_Delays;
--
--  private
--
--     type MB_Delays is new HAL.Time.Delays with null record;
--
--     overriding
--     procedure Delay_Microseconds (This : in out MB_Delays;
--                                   Us   : Integer);
--
--     overriding
--     procedure Delay_Milliseconds (This : in out MB_Delays;
--                                   Ms   : Integer);
--
--     overriding
--     procedure Delay_Seconds      (This : in out MB_Delays;
--                                   S    : Integer);
--
--

   protected Timer is
      pragma Interrupt_Priority (System.Interrupt_Priority'First);
      procedure Initialize;
      --procedure Delay_Ms (Milliseconds : UInt64);
      procedure RTC1_IRQHandler;
      pragma Attach_Handler (RTC1_IRQHandler, Ada.Interrupts.Names.RTC1_Interrupt);
      function Get_Clock return UInt64;
      function Get_AlarmSet return Boolean;
      function Tick_Period return Time_Ms;
       function Tick_Subscriber (Callback : not null Tick_Callback) return Boolean;
   --  Return True if callback is already a tick event subscriber
    function Tick_Subscribe (Callback : not null Tick_Callback) return Boolean;
    -- with Pre  => not Tick_Subscriber (Callback),
    --      Post => (if Tick_Subscribe'Result then Tick_Subscriber (Callback));
   --  Subscribe a callback to the tick event. The function return True on
   --  success, False if there's no more room for subscribers.
    function Tick_Unsubscribe (Callback : not null Tick_Callback) return Boolean;
    -- with Pre  => Tick_Subscriber (Callback),
    --      Post => (if Tick_Unsubscribe'Result then not Tick_Subscriber (Callback));
   --  Unsubscribe a callback to the tick event. The function return True on
   --  success, False if the callback was not a subscriber.

   private
      --  Data goes here
      Clock_Ms  : Time_Ms := 0 with Volatile;
      Period_Ms : Time_Ms := 1;
      Wakeup_Time : UInt64 := 0;
      AlarmSet: Boolean := False;
   end Timer;

end MicroBit.TimeWithRTC1;
