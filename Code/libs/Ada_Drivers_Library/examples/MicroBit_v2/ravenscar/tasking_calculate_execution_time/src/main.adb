--These pragma's are defined elsewhere so dont need to be enabled
--pragma Task_Dispatching_Policy(FIFO_Within_Priorities);
--pragma Locking_Policy (Ceiling_Locking);
--pragma Profile(JORVIK);

with Brain; -- we will measure one of tasks in this package

--for more information on benchmarking: see https://learn.adacore.com/courses/intro-to-ada/chapters/standard_library_dates_times.html#benchmarking
--the implementation of this timer is not ultra precise. It is based on RTC running at 30us resolution. We also have several extra instructions for readability so expect minor error between the reported execution time and the actual time.
procedure Main with Priority => 0 is --Set Interrupt Priorty P to 0, the lowest priority
begin
   loop
     null;
   end loop;
end Main;
